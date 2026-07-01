#include <string.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_ota_ops.h"
#include "esp_http_client.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "mqtt_client.h"
#include "cJSON.h"
#include "mbedtls/md.h"

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
#define WIFI_MAX_RETRIES   5

#define OTA_BUF_SIZE       4096

// Parámetros del modelo de temperatura
#define TEMP_BASE       20.0f   // temperatura inicial
#define TEMP_ALERT      40.0f   // umbral que dispara alerta
#define TEMP_MAX        45.0f   // techo absoluto
#define TEMP_SAFE       38.0f   // por debajo de aquí se resetea la alerta (2°C bajo el umbral)
#define TEMP_RISE_RATE   1.4f   // °C por ciclo con bomba apagada  (~1 min de 20 a 28)
#define TEMP_DROP_RATE   1.4f   // °C por ciclo con bomba encendida (~1 min de 28 a 20)

static const char *TAG = "simulator";
static EventGroupHandle_t wifi_events;
static int retry_count = 0;
static esp_mqtt_client_handle_t mqtt_client = NULL;
static bool ota_in_progress = false;
static volatile bool pump_on = false;

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

// ============================================================
// NVS
// ============================================================

static void load_config_from_nvs(void)
{
    nvs_handle_t nvs;
    esp_err_t err = nvs_open("config", NVS_READONLY, &nvs);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "NVS no inicializado o namespace 'config' ausente (err 0x%x)", err);
        ESP_LOGE(TAG, "Provisionar el dispositivo: ver firmware/simulator/nvs_config.csv.example");
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
            action  = "pump_on";
            ESP_LOGI(TAG, "Bomba: ENCENDIDA — temperatura comenzará a bajar");
        } else if (strcmp(type->valuestring, "pump_off") == 0) {
            pump_on = false;
            action  = "pump_off";
            ESP_LOGI(TAG, "Bomba: APAGADA — temperatura comenzará a subir");
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
// Publicación de lecturas simuladas
// ============================================================

static void publish_readings_task(void *pvParameters)
{
    float temperature = TEMP_BASE;
    float humidity    = 65.0f;
    float light       = 300.0f;
    float co2         = 500.0f;
    bool  alert_sent  = false;

    char payload[256];

    while (1) {
        if (!ota_in_progress) {

            // --- Modelo de temperatura ---
            if (pump_on) {
                temperature -= TEMP_DROP_RATE;
                if (temperature < TEMP_BASE) temperature = TEMP_BASE;
            } else {
                temperature += TEMP_RISE_RATE;
                if (temperature > TEMP_MAX) temperature = TEMP_MAX;
            }

            // Ruido de baja amplitud en todos los sensores
            float t_pub  = temperature + ((float)(esp_random() % 20) - 10) * 0.02f;
            float h_pub  = humidity    + ((float)(esp_random() % 10) -  5) * 0.1f;
            float l_pub  = light       + ((float)(esp_random() % 20) - 10) * 1.0f;
            float c_pub  = co2         + ((float)(esp_random() % 10) -  5) * 1.0f;

            // Publicar lectura
            snprintf(payload, sizeof(payload),
                "{\"temperature\":%.1f,\"humidity\":%.1f,\"light\":%.1f,\"co2\":%.1f}",
                t_pub, h_pub, l_pub, c_pub);
            esp_mqtt_client_publish(mqtt_client, topic_readings, payload, 0, 1, 0);
            ESP_LOGI(TAG, "temp=%.1f hum=%.1f co2=%.1f | bomba=%s | alerta=%s",
                t_pub, h_pub, c_pub,
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
            if (alert_sent && !pump_on && temperature <= TEMP_SAFE) {
                alert_sent = false;
                ESP_LOGI(TAG, "Temperatura normalizada (%.1f°C) — alerta reseteada", temperature);
            }
            // Con bomba encendida también resetear cuando baje lo suficiente
            if (alert_sent && pump_on && temperature <= TEMP_SAFE) {
                alert_sent = false;
                ESP_LOGI(TAG, "Temperatura normalizada con bomba (%.1f°C) — alerta reseteada", temperature);
            }
        }

        vTaskDelay(pdMS_TO_TICKS(10000));
    }
}

// ============================================================
// Entry point
// ============================================================

void app_main(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    ESP_LOGI(TAG, "Arrancando desde partición: %s", running->label);

    ESP_ERROR_CHECK(nvs_flash_init());
    load_config_from_nvs();
    wifi_init();
    mqtt_init();

    vTaskDelay(pdMS_TO_TICKS(2000));

    xTaskCreate(publish_readings_task, "readings", 4096, NULL, 5, NULL);
}
