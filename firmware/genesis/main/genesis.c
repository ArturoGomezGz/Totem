// Primer firmware Totem con sensor real y actuador físico.
//
// A diferencia de firmware/simulator (que genera lecturas sintéticas), este
// firmware lee temperatura y humedad reales de un sensor RQ-S003 (módulo
// REXQualis basado en DHT11, protocolo de un solo hilo, driver en
// firmware/components/totem_dht11) y refleja el estado de la bomba en un LED
// físico en vez de solo loguearlo.
//
// WiFi/NVS/OTA/rollback vienen de firmware/components/totem_core — ver
// firmware/NON-NEGOTIABLES.md para el contrato completo que cualquier
// firmware nuevo debe respetar.
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "nvs_flash.h"
#include "mqtt_client.h"
#include "cJSON.h"
#include "totem_core.h"
#include "totem_dht11.h"

// ============================================================
// Sensor (RQ-S003 / DHT11) y actuador (LED que simula la bomba)
// ============================================================
//
// Mapeo físico confirmado sobre el board ESP32-C6 SuperMini en uso (headers
// izquierdo/derecho leídos directamente del silkscreen):
//   - Izquierda: 5V, GND, 3V3, GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5
//   - Derecha:   TX, RX, GPIO14, GPIO15, GPIO18, GPIO19, GPIO20, GPIO21, GPIO22
//   - GPIO8 (LED RGB WS2812) y GPIO9 (botón BOOT, strapping) van integrados
//     en la placa — no están expuestos en estos headers y no deben usarse
//     para periféricos externos.
//
// DATA se movió de GPIO4 a GPIO18: GPIO4 es un pin de strapping (parte de la
// interfaz JTAG junto con GPIO5-7 en el ESP32-C6) — al descartar cableado,
// timing y sensor como causa de los timeouts persistentes, se prueba un pin
// sin ninguna función especial en el arranque para eliminar esa variable.
#define DHT_GPIO        GPIO_NUM_4   // DATA del RQ-S003 (pull-up ya incluido en el módulo)
#define PUMP_LED_GPIO   GPIO_NUM_5   // LED que simula el encendido/apagado de la bomba

// Fotoresistor (LDR) del kit RexQualis, como divisor de voltaje:
// 3V3 -> LDR -> (nodo ADC) -> resistencia fija (10kΩ) -> GND.
// Más luz => menor resistencia del LDR => mayor voltaje en el nodo ADC.
// GPIO1 = ADC1_CHANNEL_1 en el ESP32-C6, libre en el header izquierdo y sin
// función de strapping (a diferencia de GPIO4/5/8/9/15).
#define LDR_ADC_CHANNEL ADC_CHANNEL_1

// Simulación del módulo de suministro (ver
// docs/capa1/totem-principal/sistema-riego/modulo-suministro.md): antes de
// regar hay que verificar que el flotador esté arriba (solución suficiente).
// Si no, se abre la válvula NC hasta que el flotador suba.
//   - VALVE_LED_GPIO: LED que simula la válvula NC (encendido = abierta).
//   - FLOAT_SWITCH_GPIO: botón que simula el flotador. Pull-up interno,
//     activo en bajo: presionado (a GND) = flotador ARRIBA = solución
//     suficiente; soltado (HIGH) = flotador ABAJO = solución insuficiente.
#define VALVE_LED_GPIO      GPIO_NUM_2
#define FLOAT_SWITCH_GPIO   GPIO_NUM_3

// Umbral de alerta — mismo criterio que firmware/simulator, ahora evaluado
// sobre temperatura real en vez de un modelo simulado.
#define TEMP_ALERT      40.0f   // umbral que dispara alerta
#define TEMP_SAFE       38.0f   // por debajo de aquí se resetea la alerta

static const char *TAG = "genesis";
static esp_mqtt_client_handle_t mqtt_client = NULL;
static volatile bool pump_on = false;
static volatile bool valve_open = false;
static volatile bool watering_requested = false;
static totem_config_t config;
static adc_oneshot_unit_handle_t adc1_handle;

// Topics MQTT — construidos después de cargar unit_id desde NVS
static char topic_readings[96];
static char topic_commands[96];
static char topic_alerts[96];
static char topic_events[96];
static char topic_ota[96];
static char topic_profile[96];
static char topic_status[96];

static void pump_led_init(void)
{
    gpio_config_t led_cfg = {
        .pin_bit_mask = 1ULL << PUMP_LED_GPIO,
        .mode         = GPIO_MODE_OUTPUT,
    };
    gpio_config(&led_cfg);
    gpio_set_level(PUMP_LED_GPIO, 0);
}

// ============================================================
// Módulo de suministro (simulado) — flotador (botón) y válvula NC (LED)
// ============================================================

static void supply_module_init(void)
{
    gpio_config_t valve_cfg = {
        .pin_bit_mask = 1ULL << VALVE_LED_GPIO,
        .mode         = GPIO_MODE_OUTPUT,
    };
    gpio_config(&valve_cfg);
    gpio_set_level(VALVE_LED_GPIO, 0);

    gpio_config_t float_cfg = {
        .pin_bit_mask = 1ULL << FLOAT_SWITCH_GPIO,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
    };
    gpio_config(&float_cfg);
}

// true = flotador arriba (solución suficiente). Activo en bajo (pull-up).
static bool float_switch_up(void)
{
    return gpio_get_level(FLOAT_SWITCH_GPIO) == 0;
}

static void pump_set(bool on)
{
    pump_on = on;
    gpio_set_level(PUMP_LED_GPIO, on ? 1 : 0);
}

static void valve_set(bool open)
{
    valve_open = open;
    gpio_set_level(VALVE_LED_GPIO, open ? 1 : 0);
}

// Estado público del módulo de suministro, reportado al server vía
// totem/<unit_id>/events para que el dashboard distinga "regando" de
// "esperando a que se llene el tanque" en vez de ver solo silencio tras el
// comando pump_on (ver modulo-suministro.md).
typedef enum {
    SUPPLY_OFF,        // bomba y válvula apagadas
    SUPPLY_SUPPLYING,  // válvula NC abierta, esperando a que el flotador suba
    SUPPLY_PUMP_ON,    // solución suficiente, bomba regando
} supply_state_t;

static supply_state_t supply_state = SUPPLY_OFF;

static void supply_state_set(supply_state_t next)
{
    if (next == supply_state) {
        return;
    }
    supply_state = next;

    const char *action;
    switch (next) {
        case SUPPLY_SUPPLYING:
            valve_set(true);
            pump_set(false);
            action = "supplying";
            ESP_LOGI(TAG, "Suministro: ABASTECIENDO — válvula NC abierta (LED en GPIO%d), "
                "esperando flotador", VALVE_LED_GPIO);
            break;
        case SUPPLY_PUMP_ON:
            valve_set(false);
            pump_set(true);
            action = "pump_on";
            ESP_LOGI(TAG, "Suministro: BOMBA ENCENDIDA (LED en GPIO%d)", PUMP_LED_GPIO);
            break;
        case SUPPLY_OFF:
        default:
            valve_set(false);
            pump_set(false);
            action = "pump_off";
            ESP_LOGI(TAG, "Suministro: APAGADO — bomba y válvula cerradas");
            break;
    }

    char event_payload[64];
    snprintf(event_payload, sizeof(event_payload), "{\"action\":\"%s\"}", action);
    esp_mqtt_client_publish(mqtt_client, topic_events, event_payload, 0, 1, 0);
}

// Verifica el flotador antes de regar (ver modulo-suministro.md): si hay
// solución suficiente arranca la bomba directo, si no abre la válvula NC y
// espera a que el flotador suba para recién entonces empezar a regar.
static void irrigation_supply_task(void *pvParameters)
{
    while (1) {
        if (watering_requested) {
            if (supply_state != SUPPLY_PUMP_ON) {
                supply_state_set(float_switch_up() ? SUPPLY_PUMP_ON : SUPPLY_SUPPLYING);
            }
        } else {
            supply_state_set(SUPPLY_OFF);
        }

        vTaskDelay(pdMS_TO_TICKS(200));
    }
}

// ============================================================
// Fotoresistor (LDR) — indicador binario de luz
// ============================================================

static void ldr_init(void)
{
    adc_oneshot_unit_init_cfg_t init_cfg = {
        .unit_id = ADC_UNIT_1,
    };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&init_cfg, &adc1_handle));

    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten    = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1_handle, LDR_ADC_CHANNEL, &chan_cfg));
}

// Devuelve la lectura cruda del ADC (0-4095 @ 12 bits) sin ninguna
// conversión — no representa lux ni ninguna unidad real, es solo para
// testing: ver cómo varía el valor al tapar/destapar el fotoresistor.
static int ldr_read_light(void)
{
    int raw = 0;
    ESP_ERROR_CHECK(adc_oneshot_read(adc1_handle, LDR_ADC_CHANNEL, &raw));
    return raw;
}

// ============================================================
// Comandos
// ============================================================

static void handle_command(const char *data, int data_len)
{
    cJSON *json = cJSON_ParseWithLength(data, data_len);
    if (!json) {
        ESP_LOGE(TAG, "Comando: JSON inválido");
        return;
    }

    cJSON *type = cJSON_GetObjectItem(json, "type");
    if (cJSON_IsString(type)) {
        // El comando solo pide regar o dejar de regar — la verificación del
        // flotador y el control de la bomba/válvula corren aparte en
        // irrigation_supply_task, sea el origen del comando manual o
        // automático (ver modulo-suministro.md).
        if (strcmp(type->valuestring, "pump_on") == 0) {
            watering_requested = true;
            ESP_LOGI(TAG, "Riego solicitado — verificando flotador antes de arrancar la bomba");
        } else if (strcmp(type->valuestring, "pump_off") == 0) {
            watering_requested = false;
            ESP_LOGI(TAG, "Riego detenido por comando");
        } else {
            ESP_LOGW(TAG, "Comando desconocido: %s", type->valuestring);
        }
    }

    cJSON_Delete(json);
}

// ============================================================
// MQTT
// ============================================================

static void mqtt_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t) data;

    switch (id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI(TAG, "MQTT conectado");
            esp_mqtt_client_subscribe(mqtt_client, topic_commands, 1);
            esp_mqtt_client_subscribe(mqtt_client, topic_ota,      1);
            esp_mqtt_client_subscribe(mqtt_client, topic_profile,  1);
            ESP_LOGI(TAG, "Suscrito a: %s, %s, %s", topic_commands, topic_ota, topic_profile);

            totem_publish_status(mqtt_client, topic_status);
            totem_rollback_confirm();
            break;

        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGW(TAG, "MQTT desconectado");
            break;

        case MQTT_EVENT_DATA: {
            char topic[128] = {0};
            int topic_len = event->topic_len < (int)sizeof(topic) - 1
                            ? event->topic_len : (int)sizeof(topic) - 1;
            strncpy(topic, event->topic, topic_len);

            if (strcmp(topic, topic_commands) == 0) {
                ESP_LOGI(TAG, "Comando recibido: %.*s", event->data_len, event->data);
                handle_command(event->data, event->data_len);
            } else if (strcmp(topic, topic_ota) == 0) {
                ESP_LOGI(TAG, "Mensaje OTA recibido");
                totem_ota_handle_message(event->data, event->data_len);
            } else if (strcmp(topic, topic_profile) == 0) {
                ESP_LOGI(TAG, "Perfil recibido: %.*s", event->data_len, event->data);
            } else {
                ESP_LOGI(TAG, "Mensaje en [%s]: %.*s", topic, event->data_len, event->data);
            }
            break;
        }

        case MQTT_EVENT_ERROR:
            ESP_LOGE(TAG, "Error MQTT");
            break;

        default:
            break;
    }
}

static void mqtt_init(void)
{
    esp_mqtt_client_config_t cfg = {
        .broker.address.uri                  = config.mqtt_uri,
        .credentials.username                = config.unit_id,
        .credentials.authentication.password  = config.api_key,
        .credentials.client_id                = config.unit_id,
    };

    mqtt_client = esp_mqtt_client_init(&cfg);
    esp_mqtt_client_register_event(mqtt_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    esp_mqtt_client_start(mqtt_client);
}

// ============================================================
// Publicación de lecturas reales del sensor
// ============================================================

static void publish_readings_task(void *pvParameters)
{
    bool alert_sent = false;
    char payload[256];

    while (1) {
        if (!totem_ota_in_progress()) {
            float temperature, humidity;
            esp_err_t err = totem_dht11_read(DHT_GPIO, &temperature, &humidity);

            if (err != ESP_OK) {
                ESP_LOGW(TAG, "DHT11: lectura fallida (%s) — se reintenta en el próximo ciclo",
                    esp_err_to_name(err));
            } else {
                int light = ldr_read_light();
                snprintf(payload, sizeof(payload),
                    "{\"temperature\":%.1f,\"humidity\":%.1f,\"light\":%d}",
                    temperature, humidity, light);
                esp_mqtt_client_publish(mqtt_client, topic_readings, payload, 0, 1, 0);
                ESP_LOGI(TAG, "temp=%.1f hum=%.1f luz=%d | bomba=%s | alerta=%s",
                    temperature, humidity, light,
                    pump_on    ? "ON"   : "OFF",
                    alert_sent ? "ACTIVA" : "ok");

                // --- Disparar alerta al cruzar el umbral (una sola vez por ciclo) ---
                if (!alert_sent && temperature >= TEMP_ALERT) {
                    snprintf(payload, sizeof(payload),
                        "{\"type\":\"temperature_high\",\"severity\":\"warning\","
                        "\"message\":\"Temperatura critica: %.1f C (umbral: %.0f C). Activa la bomba.\"}",
                        temperature, TEMP_ALERT);
                    esp_mqtt_client_publish(mqtt_client, topic_alerts, payload, 0, 1, 0);
                    ESP_LOGW(TAG, ">>> ALERTA enviada: temperatura=%.1f°C", temperature);
                    alert_sent = true;
                }

                // --- Resetear alerta al volver al rango seguro ---
                if (alert_sent && temperature <= TEMP_SAFE) {
                    alert_sent = false;
                    ESP_LOGI(TAG, "Temperatura normalizada (%.1f°C) — alerta reseteada", temperature);
                }
            }
        }

        // El DHT11 no se puede leer más rápido que 1 vez por segundo —
        // 10s de margen es consistente con el ciclo de firmware/simulator.
        vTaskDelay(pdMS_TO_TICKS(10000));
    }
}

// ============================================================
// Entry point
// ============================================================

void app_main(void)
{
    totem_rollback_init();

    ESP_ERROR_CHECK(nvs_flash_init());
    totem_config_load(&config);

    snprintf(topic_readings, sizeof(topic_readings), "totem/%s/readings", config.unit_id);
    snprintf(topic_commands, sizeof(topic_commands), "totem/%s/commands", config.unit_id);
    snprintf(topic_alerts,   sizeof(topic_alerts),   "totem/%s/alerts",   config.unit_id);
    snprintf(topic_events,   sizeof(topic_events),   "totem/%s/events",   config.unit_id);
    snprintf(topic_ota,      sizeof(topic_ota),      "totem/%s/ota",      config.unit_id);
    snprintf(topic_profile,  sizeof(topic_profile),  "totem/%s/profile",  config.unit_id);
    snprintf(topic_status,   sizeof(topic_status),   "totem/%s/status",   config.unit_id);

    totem_dht11_gpio_init(DHT_GPIO);
    pump_led_init();
    ldr_init();
    supply_module_init();

    totem_wifi_connect(&config);
    mqtt_init();

    vTaskDelay(pdMS_TO_TICKS(2000));

    xTaskCreate(publish_readings_task, "readings", 4096, NULL, 5, NULL);
    xTaskCreate(irrigation_supply_task, "supply", 2048, NULL, 5, NULL);
}
