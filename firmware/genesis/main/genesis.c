// Primer firmware Totem con sensor real y actuador físico.
//
// A diferencia de firmware/simulator (que genera lecturas sintéticas), este
// firmware lee temperatura y humedad reales de un sensor RQ-S003 (módulo
// REXQualis basado en DHT11, protocolo de un solo hilo) y refleja el estado
// de la bomba en un LED físico en vez de solo loguearlo.
//
// El esqueleto de WiFi/NVS/OTA/MQTT/rollback es intencionalmente idéntico al
// de firmware/bootstrap y firmware/simulator — ver firmware/NON-NEGOTIABLES.md
// para el contrato completo que cualquier firmware nuevo debe respetar.
#include <string.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_ota_ops.h"
#include "esp_http_client.h"
#include "driver/gpio.h"
#include "esp_rom_sys.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "mqtt_client.h"
#include "cJSON.h"
#include "mbedtls/md.h"

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
#define WIFI_MAX_RETRIES   5

#define OTA_BUF_SIZE       4096

// Margen para confirmar que el firmware recién aplicado por OTA arrancó bien
// (WiFi + MQTT) antes de que el bootloader lo revierta automáticamente.
#define ROLLBACK_CONFIRM_TIMEOUT_MS   90000

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

// Umbral de alerta — mismo criterio que firmware/simulator, ahora evaluado
// sobre temperatura real en vez de un modelo simulado.
#define TEMP_ALERT      40.0f   // umbral que dispara alerta
#define TEMP_SAFE       38.0f   // por debajo de aquí se resetea la alerta

static const char *TAG = "genesis";
static EventGroupHandle_t wifi_events;
static int retry_count = 0;
static esp_mqtt_client_handle_t mqtt_client = NULL;
static bool ota_in_progress = false;
static volatile bool pump_on = false;
static volatile bool pending_rollback_confirm = false;

// Credenciales cargadas desde NVS al arrancar
static char wifi_ssid[64];
static char wifi_pass[64];
static char mqtt_uri[128];
static char unit_id[64];
static char api_key[128];

// Topics MQTT — construidos después de cargar unit_id desde NVS
static char topic_readings[96];
static char topic_commands[96];
static char topic_alerts[96];
static char topic_events[96];
static char topic_ota[96];
static char topic_profile[96];
static char topic_status[96];

// ============================================================
// NVS
// ============================================================

static void load_config_from_nvs(void)
{
    nvs_handle_t nvs;
    esp_err_t err = nvs_open("config", NVS_READONLY, &nvs);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "NVS no inicializado o namespace 'config' ausente (err 0x%x)", err);
        ESP_LOGE(TAG, "Provisionar el dispositivo: ver firmware/genesis/nvs_config.csv.example");
        esp_restart();
    }

    size_t len;

    len = sizeof(wifi_ssid);  ESP_ERROR_CHECK(nvs_get_str(nvs, "wifi_ssid", wifi_ssid, &len));
    len = sizeof(wifi_pass);  ESP_ERROR_CHECK(nvs_get_str(nvs, "wifi_pass", wifi_pass, &len));
    len = sizeof(mqtt_uri);   ESP_ERROR_CHECK(nvs_get_str(nvs, "mqtt_uri",  mqtt_uri,  &len));
    len = sizeof(unit_id);    ESP_ERROR_CHECK(nvs_get_str(nvs, "unit_id",   unit_id,   &len));
    len = sizeof(api_key);    ESP_ERROR_CHECK(nvs_get_str(nvs, "api_key",   api_key,   &len));

    nvs_close(nvs);

    snprintf(topic_readings, sizeof(topic_readings), "totem/%s/readings", unit_id);
    snprintf(topic_commands, sizeof(topic_commands), "totem/%s/commands", unit_id);
    snprintf(topic_alerts,   sizeof(topic_alerts),   "totem/%s/alerts",   unit_id);
    snprintf(topic_events,   sizeof(topic_events),   "totem/%s/events",   unit_id);
    snprintf(topic_ota,      sizeof(topic_ota),      "totem/%s/ota",      unit_id);
    snprintf(topic_profile,  sizeof(topic_profile),  "totem/%s/profile",  unit_id);
    snprintf(topic_status,   sizeof(topic_status),   "totem/%s/status",   unit_id);

    ESP_LOGI(TAG, "Config cargada — unit_id: %s, broker: %s", unit_id, mqtt_uri);
}

// ============================================================
// WiFi
// ============================================================

static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (retry_count < WIFI_MAX_RETRIES) {
            esp_wifi_connect();
            retry_count++;
            ESP_LOGI(TAG, "Reintentando WiFi (%d/%d)", retry_count, WIFI_MAX_RETRIES);
        } else {
            xEventGroupSetBits(wifi_events, WIFI_FAIL_BIT);
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *) data;
        ESP_LOGI(TAG, "IP obtenida: " IPSTR, IP2STR(&event->ip_info.ip));
        retry_count = 0;
        xEventGroupSetBits(wifi_events, WIFI_CONNECTED_BIT);
    }
}

static void wifi_init(void)
{
    wifi_events = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL, NULL));

    wifi_config_t wifi_config = {};
    strncpy((char *)wifi_config.sta.ssid,     wifi_ssid, sizeof(wifi_config.sta.ssid));
    strncpy((char *)wifi_config.sta.password,  wifi_pass, sizeof(wifi_config.sta.password));

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    EventBits_t bits = xEventGroupWaitBits(wifi_events,
        WIFI_CONNECTED_BIT | WIFI_FAIL_BIT, pdFALSE, pdFALSE, portMAX_DELAY);

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "WiFi conectado");
    } else {
        ESP_LOGE(TAG, "Fallo al conectar a WiFi");
    }
}

// ============================================================
// OTA
// ============================================================

typedef struct {
    char url[256];
    char sha256[65];
    char version[32];
} ota_task_params_t;

static void ota_task(void *pvParameters)
{
    ota_task_params_t *params = (ota_task_params_t *)pvParameters;
    esp_err_t err;

    ESP_LOGI(TAG, "OTA: iniciando actualización a versión %s", params->version);
    ESP_LOGI(TAG, "OTA: URL: %s", params->url);

    const esp_partition_t *update_partition = esp_ota_get_next_update_partition(NULL);
    if (!update_partition) {
        ESP_LOGE(TAG, "OTA: no hay partición disponible");
        goto ota_fail;
    }
    ESP_LOGI(TAG, "OTA: escribiendo en partición %s", update_partition->label);

    mbedtls_md_context_t sha256_ctx;
    mbedtls_md_init(&sha256_ctx);
    mbedtls_md_setup(&sha256_ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 0);
    mbedtls_md_starts(&sha256_ctx);

    esp_ota_handle_t ota_handle = 0;
    err = esp_ota_begin(update_partition, OTA_WITH_SEQUENTIAL_WRITES, &ota_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "OTA begin: %s", esp_err_to_name(err));
        mbedtls_md_free(&sha256_ctx);
        goto ota_fail;
    }

    esp_http_client_config_t http_cfg = {
        .url        = params->url,
        .timeout_ms = 30000,
    };
    esp_http_client_handle_t client = esp_http_client_init(&http_cfg);

    err = esp_http_client_open(client, 0);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "OTA HTTP open: %s", esp_err_to_name(err));
        mbedtls_md_free(&sha256_ctx);
        esp_ota_abort(ota_handle);
        esp_http_client_cleanup(client);
        goto ota_fail;
    }

    int content_length = esp_http_client_fetch_headers(client);
    ESP_LOGI(TAG, "OTA: tamaño del binario: %d bytes", content_length);

    uint8_t *buf = malloc(OTA_BUF_SIZE);
    if (!buf) {
        ESP_LOGE(TAG, "OTA: sin memoria para buffer");
        mbedtls_md_free(&sha256_ctx);
        esp_ota_abort(ota_handle);
        esp_http_client_cleanup(client);
        goto ota_fail;
    }

    int total_written = 0;
    while (1) {
        int read_len = esp_http_client_read(client, (char *)buf, OTA_BUF_SIZE);
        if (read_len < 0) {
            ESP_LOGE(TAG, "OTA: error HTTP al leer");
            free(buf);
            mbedtls_md_free(&sha256_ctx);
            esp_ota_abort(ota_handle);
            esp_http_client_cleanup(client);
            goto ota_fail;
        }
        if (read_len == 0) break;

        mbedtls_md_update(&sha256_ctx, buf, read_len);

        err = esp_ota_write(ota_handle, buf, read_len);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "OTA write: %s", esp_err_to_name(err));
            free(buf);
            mbedtls_md_free(&sha256_ctx);
            esp_ota_abort(ota_handle);
            esp_http_client_cleanup(client);
            goto ota_fail;
        }

        total_written += read_len;
        ESP_LOGI(TAG, "OTA: %d / %d bytes", total_written, content_length);
    }

    free(buf);
    esp_http_client_cleanup(client);

    uint8_t sha256_result[32];
    mbedtls_md_finish(&sha256_ctx, sha256_result);
    mbedtls_md_free(&sha256_ctx);

    char sha256_hex[65];
    for (int i = 0; i < 32; i++) {
        snprintf(sha256_hex + i * 2, 3, "%02x", sha256_result[i]);
    }
    sha256_hex[64] = '\0';

    if (strncmp(sha256_hex, params->sha256, 64) != 0) {
        ESP_LOGE(TAG, "OTA: SHA-256 inválido");
        ESP_LOGE(TAG, "  Esperado:  %s", params->sha256);
        ESP_LOGE(TAG, "  Calculado: %s", sha256_hex);
        esp_ota_abort(ota_handle);
        goto ota_fail;
    }
    ESP_LOGI(TAG, "OTA: SHA-256 verificado OK");

    err = esp_ota_end(ota_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "OTA end: %s", esp_err_to_name(err));
        goto ota_fail;
    }

    err = esp_ota_set_boot_partition(update_partition);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "OTA set_boot_partition: %s", esp_err_to_name(err));
        goto ota_fail;
    }

    ESP_LOGI(TAG, "OTA: actualización completa — reiniciando en 2s");
    free(params);
    vTaskDelay(pdMS_TO_TICKS(2000));
    esp_restart();
    return;

ota_fail:
    ESP_LOGE(TAG, "OTA: falló — el dispositivo sigue en la versión actual");
    free(params);
    ota_in_progress = false;
    vTaskDelete(NULL);
}

static void handle_ota_message(const char *data, int data_len)
{
    if (ota_in_progress) {
        ESP_LOGW(TAG, "OTA ya en progreso, ignorando mensaje");
        return;
    }

    cJSON *json = cJSON_ParseWithLength(data, data_len);
    if (!json) {
        ESP_LOGE(TAG, "OTA: JSON inválido");
        return;
    }

    cJSON *url_item     = cJSON_GetObjectItem(json, "url");
    cJSON *sha256_item  = cJSON_GetObjectItem(json, "sha256");
    cJSON *version_item = cJSON_GetObjectItem(json, "version");

    if (!cJSON_IsString(url_item) || !cJSON_IsString(sha256_item) || !cJSON_IsString(version_item)) {
        ESP_LOGE(TAG, "OTA: mensaje incompleto (falta url, sha256 o version)");
        cJSON_Delete(json);
        return;
    }

    ota_task_params_t *params = malloc(sizeof(ota_task_params_t));
    if (!params) {
        ESP_LOGE(TAG, "OTA: sin memoria");
        cJSON_Delete(json);
        return;
    }

    strncpy(params->url,     url_item->valuestring,     sizeof(params->url) - 1);
    strncpy(params->sha256,  sha256_item->valuestring,  sizeof(params->sha256) - 1);
    strncpy(params->version, version_item->valuestring, sizeof(params->version) - 1);
    params->url[sizeof(params->url) - 1]         = '\0';
    params->sha256[sizeof(params->sha256) - 1]   = '\0';
    params->version[sizeof(params->version) - 1] = '\0';

    cJSON_Delete(json);

    ota_in_progress = true;
    xTaskCreate(ota_task, "ota_task", 8192, params, 5, NULL);
}

// ============================================================
// Sensor RQ-S003 (DHT11) — lectura por protocolo de un solo hilo
// ============================================================
//
// El módulo ya trae su propia resistencia pull-up en DATA. No se puede leer
// más rápido que 1 vez por segundo (limitación del propio DHT11) — el ciclo
// de publicación de este firmware (10s) da margen de sobra.

#define DHT_TIMEOUT_US 1000

// Espera a que la línea alcance el nivel esperado, con timeout en microsegundos.
// Devuelve el tiempo transcurrido en el nivel previo (útil para medir el
// ancho de los pulsos de dato), o -1 si se agotó el timeout.
static int64_t dht_wait_level(gpio_num_t gpio, int level, int64_t timeout_us)
{
    int64_t start = esp_timer_get_time();
    while (gpio_get_level(gpio) != level) {
        if (esp_timer_get_time() - start > timeout_us) {
            return -1;
        }
    }
    return esp_timer_get_time();
}

static portMUX_TYPE dht_mux = portMUX_INITIALIZER_UNLOCKED;

// Etapas del protocolo, usadas solo para diagnóstico cuando falla.
enum {
    DHT_STAGE_OK = 0,
    DHT_STAGE_RESP_LOW,   // el sensor nunca baja la línea tras la señal de inicio
    DHT_STAGE_RESP_HIGH,  // el sensor bajó pero nunca sube (fin del pulso de 80us bajo)
    DHT_STAGE_RESP_LOW2,  // el sensor no vuelve a bajar tras el pulso de 80us alto
    DHT_STAGE_BIT_HIGH,   // timeout esperando el inicio (flanco alto) de un bit de dato
    DHT_STAGE_BIT_LOW,    // timeout esperando el fin (flanco bajo) de un bit de dato
};

static esp_err_t dht11_read(float *temperature, float *humidity)
{
    uint8_t data[5] = {0};
    esp_err_t err = ESP_OK;
    int fail_stage = DHT_STAGE_OK;
    int fail_bit = -1;

    // Nivel de la línea en reposo justo antes de iniciar — si no está en
    // alto (pull-up del módulo sosteniéndola), algo la está reteniendo baja
    // (cableado en corto, GND cruzado con DATA, módulo sin alimentación).
    int idle_level = gpio_get_level(DHT_GPIO);

    // Señal de inicio: el maestro baja la línea >=18ms y la libera.
    //
    // OJO con el tick de FreeRTOS: con CONFIG_FREERTOS_HZ=100 (tick de 10ms),
    // pdMS_TO_TICKS(18) se TRUNCA por división entera a 1 tick = 10ms, muy por
    // debajo del mínimo de 18ms que exige el DHT11 — el sensor nunca reconoce
    // la señal de inicio y jamás responde (timeout en 'sin-respuesta(bajo)').
    // Este fue el bug real: no dependía del GPIO (fallaba igual en 4 y 18).
    //
    // Se usa un busy-wait preciso de 20ms, independiente del tick, para
    // garantizar el mínimo sin importar CONFIG_FREERTOS_HZ. Va fuera de la
    // sección crítica, así que WiFi/MQTT siguen atendiéndose durante la espera.
    gpio_set_direction(DHT_GPIO, GPIO_MODE_OUTPUT);
    gpio_set_level(DHT_GPIO, 0);
    esp_rom_delay_us(20000);

    // A partir de aquí el protocolo depende de pulsos de 26-70us — si el
    // scheduler o una ISR de WiFi nos quita la CPU en este tramo (~5ms),
    // perdemos la ventana de respuesta del sensor y todo el resto de la
    // lectura hace timeout aunque el DHT11 sí haya respondido a tiempo. Se
    // deshabilitan interrupciones/scheduler para todo el tramo de timing.
    portENTER_CRITICAL(&dht_mux);

    gpio_set_level(DHT_GPIO, 1);
    esp_rom_delay_us(30);
    gpio_set_direction(DHT_GPIO, GPIO_MODE_INPUT);

    // Respuesta del sensor: 80us bajo + 80us alto antes de los datos
    if (dht_wait_level(DHT_GPIO, 0, DHT_TIMEOUT_US) < 0) { err = ESP_ERR_TIMEOUT; fail_stage = DHT_STAGE_RESP_LOW; goto done; }
    if (dht_wait_level(DHT_GPIO, 1, DHT_TIMEOUT_US) < 0) { err = ESP_ERR_TIMEOUT; fail_stage = DHT_STAGE_RESP_HIGH; goto done; }
    if (dht_wait_level(DHT_GPIO, 0, DHT_TIMEOUT_US) < 0) { err = ESP_ERR_TIMEOUT; fail_stage = DHT_STAGE_RESP_LOW2; goto done; }

    // 40 bits de datos: cada bit empieza con ~50us bajo, seguido de un nivel
    // alto cuya duración codifica el valor (~26-28us = '0', ~70us = '1')
    for (int i = 0; i < 40; i++) {
        if (dht_wait_level(DHT_GPIO, 1, DHT_TIMEOUT_US) < 0) { err = ESP_ERR_TIMEOUT; fail_stage = DHT_STAGE_BIT_HIGH; fail_bit = i; goto done; }
        int64_t high_start = esp_timer_get_time();
        if (dht_wait_level(DHT_GPIO, 0, DHT_TIMEOUT_US) < 0) { err = ESP_ERR_TIMEOUT; fail_stage = DHT_STAGE_BIT_LOW; fail_bit = i; goto done; }
        int64_t high_len = esp_timer_get_time() - high_start;

        data[i / 8] <<= 1;
        if (high_len > 40) {
            data[i / 8] |= 1;
        }
    }

done:
    portEXIT_CRITICAL(&dht_mux);

    if (err != ESP_OK) {
        static const char *stage_name[] = {
            "ok", "sin-respuesta(bajo)", "sin-respuesta(alto)", "sin-respuesta(bajo2)",
            "bit-flanco-alto", "bit-flanco-bajo",
        };
        char bit_info[16] = "";
        if (fail_bit >= 0) {
            snprintf(bit_info, sizeof(bit_info), " (bit %d)", fail_bit);
        }
        ESP_LOGW(TAG, "DHT11: timeout en etapa '%s'%s — linea en reposo antes de iniciar: %s, bytes parciales: %02x %02x %02x %02x %02x",
            stage_name[fail_stage], bit_info,
            idle_level ? "alto (normal)" : "BAJO (posible corto/sin pull-up)",
            data[0], data[1], data[2], data[3], data[4]);
        return err;
    }

    uint8_t checksum = (uint8_t)(data[0] + data[1] + data[2] + data[3]);
    if (checksum != data[4]) {
        ESP_LOGW(TAG, "DHT11: checksum inválido (esperado %02x, calculado %02x)", data[4], checksum);
        return ESP_ERR_INVALID_CRC;
    }

    // El DHT11 reporta enteros — data[1] y data[3] (partes decimales) son
    // siempre 0 en este modelo, a diferencia del DHT22.
    *humidity    = (float)data[0];
    *temperature = (float)data[2];
    return ESP_OK;
}

static void dht_gpio_init(void)
{
    gpio_config_t dht_cfg = {
        .pin_bit_mask = 1ULL << DHT_GPIO,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
    };
    gpio_config(&dht_cfg);

    gpio_set_level(DHT_GPIO, 1);
}

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
        const char *action = NULL;

        if (strcmp(type->valuestring, "pump_on") == 0) {
            pump_on = true;
            gpio_set_level(PUMP_LED_GPIO, 1);
            action  = "pump_on";
            ESP_LOGI(TAG, "Bomba: ENCENDIDA (LED en GPIO%d)", PUMP_LED_GPIO);
        } else if (strcmp(type->valuestring, "pump_off") == 0) {
            pump_on = false;
            gpio_set_level(PUMP_LED_GPIO, 0);
            action  = "pump_off";
            ESP_LOGI(TAG, "Bomba: APAGADA (LED en GPIO%d)", PUMP_LED_GPIO);
        } else {
            ESP_LOGW(TAG, "Comando desconocido: %s", type->valuestring);
        }

        // Notificar al servidor el cambio de estado de la bomba
        if (action) {
            char event_payload[64];
            snprintf(event_payload, sizeof(event_payload), "{\"action\":\"%s\"}", action);
            esp_mqtt_client_publish(mqtt_client, topic_events, event_payload, 0, 1, 0);
        }
    }

    cJSON_Delete(json);
}

// ============================================================
// MQTT
// ============================================================

// Versión de este binario — viene de version.txt (ver raíz del proyecto),
// incrustada por ESP-IDF en el descriptor de la app en tiempo de build.
// El server la extrae de los mismos bytes del .bin al publicarlo, así que
// nunca puede desincronizarse de lo que el dispositivo realmente reporta.
static const char *firmware_version(void)
{
    return esp_ota_get_app_description()->version;
}

static void publish_status(void)
{
    char payload[64];
    snprintf(payload, sizeof(payload), "{\"firmware_version\":\"%s\"}", firmware_version());
    // retain=1 — el server debe conocer la última versión reportada aunque
    // se reinicie y se resuscriba después de que el dispositivo publicó esto.
    esp_mqtt_client_publish(mqtt_client, topic_status, payload, 0, 1, 1);
    ESP_LOGI(TAG, "Version reportada al servidor: %s", firmware_version());
}

// Si esta partición quedó pendiente de verificar tras un OTA y nunca se
// confirma (WiFi/MQTT no llegan a conectar con el nuevo firmware), fuerza
// un reinicio dentro del margen — al no estar confirmada, el bootloader
// revierte automáticamente a la partición anterior conocida como válida.
static void rollback_watchdog_task(void *pvParameters)
{
    vTaskDelay(pdMS_TO_TICKS(ROLLBACK_CONFIRM_TIMEOUT_MS));
    if (pending_rollback_confirm) {
        ESP_LOGE(TAG, "No se confirmo el nuevo firmware en %d ms - reiniciando para revertir (rollback)",
            ROLLBACK_CONFIRM_TIMEOUT_MS);
        esp_restart();
    }
    vTaskDelete(NULL);
}

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

            publish_status();

            // Llegar hasta aqui prueba que WiFi + credenciales MQTT del
            // firmware nuevo funcionan de punta a punta — seguro confirmar.
            if (pending_rollback_confirm) {
                esp_ota_mark_app_valid_cancel_rollback();
                pending_rollback_confirm = false;
                ESP_LOGI(TAG, "Firmware %s confirmado como valido - rollback cancelado", firmware_version());
            }
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
                handle_ota_message(event->data, event->data_len);
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
        .broker.address.uri                       = mqtt_uri,
        .credentials.username                     = unit_id,
        .credentials.authentication.password      = api_key,
        .credentials.client_id                    = unit_id,
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
        if (!ota_in_progress) {
            float temperature, humidity;
            esp_err_t err = dht11_read(&temperature, &humidity);

            if (err != ESP_OK) {
                ESP_LOGW(TAG, "DHT11: lectura fallida (%s) — se reintenta en el próximo ciclo",
                    esp_err_to_name(err));
            } else {
                snprintf(payload, sizeof(payload),
                    "{\"temperature\":%.1f,\"humidity\":%.1f}", temperature, humidity);
                esp_mqtt_client_publish(mqtt_client, topic_readings, payload, 0, 1, 0);
                ESP_LOGI(TAG, "temp=%.1f hum=%.1f | bomba=%s | alerta=%s",
                    temperature, humidity,
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
    const esp_partition_t *running = esp_ota_get_running_partition();
    ESP_LOGI(TAG, "Arrancando desde partición: %s (firmware %s)", running->label, firmware_version());

    esp_ota_img_states_t ota_state;
    if (esp_ota_get_state_partition(running, &ota_state) == ESP_OK
        && ota_state == ESP_OTA_IMG_PENDING_VERIFY) {
        ESP_LOGW(TAG, "Particion pendiente de verificar tras OTA — confirmando al conectar a MQTT");
        pending_rollback_confirm = true;
        xTaskCreate(rollback_watchdog_task, "rollback_wd", 2048, NULL, 5, NULL);
    }

    ESP_ERROR_CHECK(nvs_flash_init());
    load_config_from_nvs();

    dht_gpio_init();
    pump_led_init();

    wifi_init();
    mqtt_init();

    vTaskDelay(pdMS_TO_TICKS(2000));

    xTaskCreate(publish_readings_task, "readings", 4096, NULL, 5, NULL);
}
