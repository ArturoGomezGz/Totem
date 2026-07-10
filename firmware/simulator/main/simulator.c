// Firmware con lecturas sintéticas — genera datos como si fuera un ESP32
// real, sin sensores físicos. Útil para desarrollar el stack del server sin
// hardware.
//
// WiFi/NVS/OTA/rollback vienen de firmware/components/totem_core — ver
// firmware/NON-NEGOTIABLES.md para el contrato completo que cualquier
// firmware nuevo debe respetar.
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_random.h"
#include "nvs_flash.h"
#include "mqtt_client.h"
#include "cJSON.h"
#include "totem_core.h"

// Parámetros del modelo de temperatura
#define TEMP_BASE       20.0f   // temperatura inicial
#define TEMP_ALERT      40.0f   // umbral que dispara alerta
#define TEMP_MAX        45.0f   // techo absoluto
#define TEMP_SAFE       38.0f   // por debajo de aquí se resetea la alerta (2°C bajo el umbral)
#define TEMP_RISE_RATE   1.4f   // °C por ciclo con bomba apagada  (~1 min de 20 a 28)
#define TEMP_DROP_RATE   1.4f   // °C por ciclo con bomba encendida (~1 min de 28 a 20)

static const char *TAG = "simulator";
static esp_mqtt_client_handle_t mqtt_client = NULL;
static volatile bool pump_on = false;
static totem_config_t config;

// Topics MQTT — construidos después de cargar unit_id desde NVS
static char topic_readings[96];
static char topic_commands[96];
static char topic_alerts[96];
static char topic_events[96];
static char topic_ota[96];
static char topic_profile[96];
static char topic_status[96];

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
// Publicación de lecturas simuladas
// ============================================================

static void publish_readings_task(void *pvParameters)
{
    float temperature = TEMP_BASE;
    float humidity    = 65.0f;
    float light       = 300.0f;
    bool  alert_sent  = false;

    char payload[256];

    while (1) {
        if (!totem_ota_in_progress()) {

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

            // Publicar lectura
            snprintf(payload, sizeof(payload),
                "{\"temperature\":%.1f,\"humidity\":%.1f,\"light\":%.1f}",
                t_pub, h_pub, l_pub);
            esp_mqtt_client_publish(mqtt_client, topic_readings, payload, 0, 1, 0);
            ESP_LOGI(TAG, "temp=%.1f hum=%.1f | bomba=%s | alerta=%s",
                t_pub, h_pub,
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

    totem_wifi_connect(&config);
    mqtt_init();

    vTaskDelay(pdMS_TO_TICKS(2000));

    xTaskCreate(publish_readings_task, "readings", 4096, NULL, 5, NULL);
}
