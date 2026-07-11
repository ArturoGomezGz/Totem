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
#include <math.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "nvs.h"
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
//   - FLOAT_SWITCH_GPIO: flotador real (interruptor mecánico), con pull-up
//     interno. A diferencia de un botón normal, este flotador **cierra el
//     circuito (deja pasar corriente) cuando está ABAJO** y lo **abre
//     (corta la corriente) cuando está ARRIBA** — es decir, LOW = flotador
//     abajo (solución insuficiente), HIGH = flotador arriba (suficiente).
#define VALVE_LED_GPIO      GPIO_NUM_2
#define FLOAT_SWITCH_GPIO   GPIO_NUM_3

// Umbral de alerta — mismo criterio que firmware/simulator, ahora evaluado
// sobre temperatura real en vez de un modelo simulado.
#define TEMP_ALERT      40.0f   // umbral que dispara alerta
#define TEMP_SAFE       38.0f   // por debajo de aquí se resetea la alerta

// Intervalo del ciclo de decisión automático — candidato documentado en
// docs/ecosistema/overview.md ("Decisiones pendientes").
#define DECISION_INTERVAL_MS (3 * 60 * 1000)

// Namespace/clave NVS donde se cachea el último perfil recibido (crudo, tal
// cual llega por MQTT) — ver docs/transversal/crop-profile.md: el ESP32
// siempre debe poder decidir con el último perfil conocido, incluso offline.
#define PROFILE_NVS_NAMESPACE "profile"
#define PROFILE_NVS_KEY       "json"
#define PROFILE_JSON_MAX_LEN  512

static const char *TAG = "genesis";
static esp_mqtt_client_handle_t mqtt_client = NULL;
static volatile bool pump_on = false;
static volatile bool valve_open = false;
static volatile bool watering_requested = false;
static totem_config_t config;
static adc_oneshot_unit_handle_t adc1_handle;

// ============================================================
// Módulo de Decisión de Riego — VPD (T, RH) + modulador de luz
// ============================================================
// Ver docs/capa1/totem-principal/sistema-decision/modulo-decision.md.
// Nada de esto usa ML: VPD es fórmula cerrada (Tetens) y la duración es
// aritmética simple sobre el perfil activo.

typedef enum {
    TRIGGER_NONE,        // nadie controla la bomba ahora mismo
    TRIGGER_MANUAL,      // un comando pump_on/pump_off desde el dashboard tiene el control
    TRIGGER_AUTONOMOUS,  // el ciclo de decisión automático tiene el control
} water_trigger_t;

static volatile water_trigger_t current_trigger = TRIGGER_NONE;

// Sellado en la transición a SUPPLY_OFF (ver supply_state_set), sin importar
// si el riego que acaba de terminar fue manual o automático. El ciclo de
// decisión automático nunca dispara antes de que pase min_interval_s desde
// aquí — así un riego manual reinicia la espera del siguiente automático en
// vez de dejar que se disparen casi seguidos.
static volatile int64_t last_watering_end_us = 0;

// false hasta el primer riego real. Sin esto, min_interval_s se compararía
// contra el tiempo de uptime desde el arranque (last_watering_end_us queda
// en 0 hasta el primer pump_off) — un min_interval_s mayor al tiempo que
// lleva encendida la unidad bloquearía el primer ciclo automático aunque
// nunca se haya regado. "Nunca regué" debe permitir regar de inmediato, no
// comportarse como "acabo de regar en el instante del arranque".
static volatile bool has_watered_since_boot = false;

typedef struct {
    bool  loaded;
    char  irrigation_method[32];
    bool  has_light_range;
    float light_min;
    float light_max;
    float threshold_vpd_kpa;  // vpd_threshold
    float base_duration_s;    // vpd_threshold
    float cycle_duration_s;   // fixed_timer
    float min_interval_s;     // ambos métodos
} crop_profile_t;

static crop_profile_t active_profile = { .loaded = false };

// Última lectura válida de T/RH — el ciclo de decisión no vuelve a leer el
// sensor, reutiliza lo que ya publicó publish_readings_task en este ciclo.
static volatile float last_temperature = NAN;
static volatile float last_humidity = NAN;

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

// true = flotador arriba (solución suficiente). El flotador corta el
// circuito al subir, así que con el pull-up interno arriba = HIGH.
static bool float_switch_up(void)
{
    return gpio_get_level(FLOAT_SWITCH_GPIO) == 1;
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
            // Sella el fin del riego sin importar el origen (manual o
            // automático) — irrigation_decision_task usa esto para no
            // volver a disparar antes de min_interval_s. Ver el enum
            // water_trigger_t más arriba.
            last_watering_end_us = esp_timer_get_time();
            has_watered_since_boot = true;
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
// VPD (Déficit de Presión de Vapor) — ecuación de Tetens
// ============================================================
// SVP(T) = 0.6108 * exp(17.27*T / (T+237.3))  [kPa]
// VPD    = SVP(T) * (1 - RH/100)              [kPa]

static float vpd_calc_kpa(float temp_c, float humidity_pct)
{
    float svp = 0.6108f * expf(17.27f * temp_c / (temp_c + 237.3f));
    return svp * (1.0f - humidity_pct / 100.0f);
}

// ============================================================
// Luz simulada para g(Li) — ver decisión del 11 jul 2026 en
// modulo-decision.md: el LDR de este firmware da conteos crudos de ADC, no
// µmol/m²/s, así que no es comparable contra light_min/light_max del
// perfil. Mientras no haya sensor calibrado, se simula un ciclo día/noche
// corto (no depende de hora real — no hay NTP en este firmware) solo para
// poder probar el modulador end-to-end. El LDR real se sigue publicando tal
// cual en `readings.light`, sin tocar — esto NO lo reemplaza, solo
// alimenta la fórmula internamente hasta que llegue el sensor definitivo.
#define SIMULATED_LIGHT_CYCLE_US (10LL * 60 * 1000000)  // "día" sintético de 10 min

#ifndef M_PI
#define M_PI 3.14159265358979323846f
#endif

static float simulated_light_par(void)
{
    int64_t phase_us = esp_timer_get_time() % SIMULATED_LIGHT_CYCLE_US;
    float phase = (float)phase_us / (float)SIMULATED_LIGHT_CYCLE_US;  // 0..1
    float level = sinf(phase * (float)M_PI);                          // 0..1..0
    if (level < 0.0f) level = 0.0f;
    return level * 900.0f;  // rango PAR de referencia usado en firmware/simulator
}

// ============================================================
// Perfil de Cultivo Activo — caché en flash (NVS) + parseo
// ============================================================
// Ver docs/transversal/crop-profile.md: la decisión de riego debe seguir
// funcionando con el último perfil conocido aunque la unidad esté offline.

static void profile_save_raw(const char *data, int data_len)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(PROFILE_NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Perfil: no se pudo abrir NVS para cachear (%s)", esp_err_to_name(err));
        return;
    }

    char buf[PROFILE_JSON_MAX_LEN];
    int len = data_len < (int)sizeof(buf) - 1 ? data_len : (int)sizeof(buf) - 1;
    memcpy(buf, data, len);
    buf[len] = '\0';

    err = nvs_set_str(handle, PROFILE_NVS_KEY, buf);
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Perfil: no se pudo escribir en NVS (%s)", esp_err_to_name(err));
    }
    nvs_close(handle);
}

// true si logró cargar un perfil cacheado en buf (deja buf null-terminado).
static bool profile_load_raw(char *buf, size_t buf_size)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(PROFILE_NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) {
        return false;  // namespace no existe todavía — unidad nunca recibió un perfil
    }

    size_t len = buf_size;
    err = nvs_get_str(handle, PROFILE_NVS_KEY, buf, &len);
    nvs_close(handle);
    return err == ESP_OK;
}

// Parsea el perfil (mismo payload que publica routers/units.py assign_profile)
// hacia active_profile. No valida contra irrigation_methods — el server ya
// lo hizo antes de asignarlo; el firmware solo necesita los campos que usa.
static bool profile_parse(const char *data, int data_len)
{
    cJSON *json = cJSON_ParseWithLength(data, data_len);
    if (!json) {
        ESP_LOGE(TAG, "Perfil: JSON inválido");
        return false;
    }

    crop_profile_t next = { .loaded = true };

    cJSON *method = cJSON_GetObjectItem(json, "irrigation_method");
    if (cJSON_IsString(method)) {
        strncpy(next.irrigation_method, method->valuestring, sizeof(next.irrigation_method) - 1);
    }

    cJSON *light_min = cJSON_GetObjectItem(json, "light_min");
    cJSON *light_max = cJSON_GetObjectItem(json, "light_max");
    if (cJSON_IsNumber(light_min) && cJSON_IsNumber(light_max)) {
        next.has_light_range = true;
        next.light_min = (float)light_min->valuedouble;
        next.light_max = (float)light_max->valuedouble;
    }

    cJSON *params = cJSON_GetObjectItem(json, "irrigation_params");
    if (cJSON_IsObject(params)) {
        cJSON *v;
        if ((v = cJSON_GetObjectItem(params, "threshold_vpd_kpa")) && cJSON_IsNumber(v)) {
            next.threshold_vpd_kpa = (float)v->valuedouble;
        }
        if ((v = cJSON_GetObjectItem(params, "base_duration_s")) && cJSON_IsNumber(v)) {
            next.base_duration_s = (float)v->valuedouble;
        }
        if ((v = cJSON_GetObjectItem(params, "cycle_duration_s")) && cJSON_IsNumber(v)) {
            next.cycle_duration_s = (float)v->valuedouble;
        }
        if ((v = cJSON_GetObjectItem(params, "min_interval_s")) && cJSON_IsNumber(v)) {
            next.min_interval_s = (float)v->valuedouble;
        }
    }

    cJSON_Delete(json);

    if (next.irrigation_method[0] == '\0') {
        ESP_LOGW(TAG, "Perfil: sin irrigation_method, se ignora");
        return false;
    }

    active_profile = next;
    ESP_LOGI(TAG, "Perfil activo: método=%s umbral_vpd=%.2f duracion_base=%.0f duracion_fija=%.0f intervalo_min=%.0f",
        active_profile.irrigation_method, active_profile.threshold_vpd_kpa,
        active_profile.base_duration_s, active_profile.cycle_duration_s, active_profile.min_interval_s);
    return true;
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
            // Manual siempre toma el control, incluso si el ciclo automático
            // estaba regando — ver irrigation_decision_task, que aborta en
            // cuanto detecta que current_trigger ya no es TRIGGER_AUTONOMOUS.
            current_trigger = TRIGGER_MANUAL;
            watering_requested = true;
            ESP_LOGI(TAG, "Riego solicitado (manual) — verificando flotador antes de arrancar la bomba");
        } else if (strcmp(type->valuestring, "pump_off") == 0) {
            current_trigger = TRIGGER_NONE;
            watering_requested = false;
            ESP_LOGI(TAG, "Riego detenido por comando manual");
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
                if (profile_parse(event->data, event->data_len)) {
                    profile_save_raw(event->data, event->data_len);
                }
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
                last_temperature = temperature;
                last_humidity = humidity;

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
// Ciclo de decisión automático — VPD (y timer fijo) + arbitraje con manual
// ============================================================

static void irrigation_decision_task(void *pvParameters)
{
    bool first_run = true;

    while (1) {
        // Primera evaluación pronto tras el arranque (no hay que esperar los
        // 3 min completos para la primera decisión) — solo el margen para
        // que publish_readings_task ya haya hecho al menos una lectura de
        // T/RH. Las siguientes vueltas del loop sí respetan el intervalo
        // completo (incluidos los "continue" de abajo, que vuelven aquí).
        vTaskDelay(pdMS_TO_TICKS(first_run ? 15000 : DECISION_INTERVAL_MS));
        first_run = false;

        if (totem_ota_in_progress()) {
            continue;
        }
        if (current_trigger != TRIGGER_NONE) {
            // Hay control manual activo (o, por construcción, no debería
            // haber otro ciclo automático corriendo a la vez) — no interferir.
            ESP_LOGI(TAG, "Decisión automática: en pausa, hay riego manual activo");
            continue;
        }
        if (!active_profile.loaded) {
            ESP_LOGI(TAG, "Decisión automática: sin perfil activo, no se riega");
            continue;
        }

        if (has_watered_since_boot) {
            int64_t elapsed_s = (esp_timer_get_time() - last_watering_end_us) / 1000000LL;
            if (elapsed_s < (int64_t)active_profile.min_interval_s) {
                ESP_LOGI(TAG, "Decisión automática: intervalo mínimo no cumplido (%llds/%.0fs)",
                    (long long)elapsed_s, active_profile.min_interval_s);
                continue;
            }
        }

        bool  should_water = false;
        float duration_s = 0.0f;

        if (strcmp(active_profile.irrigation_method, "fixed_timer") == 0) {
            should_water = true;
            duration_s = active_profile.cycle_duration_s;
        } else if (strcmp(active_profile.irrigation_method, "vpd_threshold") == 0) {
            if (isnan(last_temperature) || isnan(last_humidity)) {
                ESP_LOGI(TAG, "Decisión automática: sin lectura de T/RH todavía");
                continue;
            }
            float vpd = vpd_calc_kpa(last_temperature, last_humidity);
            if (vpd >= active_profile.threshold_vpd_kpa) {
                float f = vpd / active_profile.threshold_vpd_kpa;
                if (f > 2.0f) f = 2.0f;

                float light_ref = active_profile.has_light_range
                    ? (active_profile.light_min + active_profile.light_max) / 2.0f
                    : 1.0f;
                float li = active_profile.has_light_range ? simulated_light_par() : light_ref;
                float g = (light_ref > 0.0f) ? (li / light_ref) : 1.0f;
                if (g < 0.5f) g = 0.5f;
                if (g > 1.5f) g = 1.5f;

                should_water = true;
                duration_s = active_profile.base_duration_s * f * g;
                ESP_LOGI(TAG, "VPD=%.2f kPa (umbral %.2f) f=%.2f g=%.2f -> %.0fs",
                    vpd, active_profile.threshold_vpd_kpa, f, g, duration_s);
            } else {
                ESP_LOGI(TAG, "VPD=%.2f kPa bajo el umbral %.2f — no se riega",
                    vpd, active_profile.threshold_vpd_kpa);
            }
        } else {
            ESP_LOGW(TAG, "Decisión automática: método desconocido '%s'", active_profile.irrigation_method);
        }

        if (!should_water || duration_s <= 0.0f) {
            continue;
        }

        current_trigger = TRIGGER_AUTONOMOUS;
        watering_requested = true;
        ESP_LOGI(TAG, "Riego automático iniciado — duración calculada: %.0fs", duration_s);

        // Sleep en pasos de 1s en vez de un solo vTaskDelay(duration_s): así,
        // si llega un comando manual a mitad del ciclo, current_trigger deja
        // de ser TRIGGER_AUTONOMOUS y esta tarea suelta el control de
        // inmediato en vez de pelear con el comando manual al final.
        bool interrupted = false;
        for (int elapsed = 0; elapsed < (int)duration_s; elapsed++) {
            vTaskDelay(pdMS_TO_TICKS(1000));
            if (current_trigger != TRIGGER_AUTONOMOUS) {
                ESP_LOGI(TAG, "Riego automático interrumpido por control manual");
                interrupted = true;
                break;
            }
        }

        if (!interrupted) {
            watering_requested = false;
            current_trigger = TRIGGER_NONE;
        }
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

    // Perfil cacheado en NVS de un arranque anterior — se carga antes de
    // conectar WiFi para poder decidir riego aunque la unidad arranque
    // offline (docs/transversal/crop-profile.md). Si nunca se recibió un
    // perfil, active_profile.loaded queda en false y el ciclo de decisión
    // no riega hasta que llegue uno por MQTT.
    char cached_profile[PROFILE_JSON_MAX_LEN];
    if (profile_load_raw(cached_profile, sizeof(cached_profile))) {
        if (profile_parse(cached_profile, (int)strlen(cached_profile))) {
            ESP_LOGI(TAG, "Perfil cacheado en NVS cargado correctamente");
        }
    } else {
        ESP_LOGI(TAG, "Sin perfil cacheado en NVS — esperando el primero por MQTT");
    }

    totem_wifi_connect(&config);
    mqtt_init();

    vTaskDelay(pdMS_TO_TICKS(2000));

    xTaskCreate(publish_readings_task, "readings", 4096, NULL, 5, NULL);
    xTaskCreate(irrigation_supply_task, "supply", 2048, NULL, 5, NULL);
    xTaskCreate(irrigation_decision_task, "decision", 4096, NULL, 5, NULL);
}
