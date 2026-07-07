// Firmware base de fábrica.
//
// Es el ÚNICO binario que se flashea por USB en una unidad nueva. No sensa,
// no riega, no maneja perfiles ni alertas — su único trabajo es conectar a
// WiFi/MQTT, reportar su versión, y esperar el primer OTA hacia un firmware
// con funcionalidad real (ver firmware/simulator/main/simulator.c). A partir
// de ahí, todo el ciclo de vida del dispositivo es 100% OTA.
//
// WiFi/NVS/OTA/rollback vienen de firmware/components/totem_core — ver
// firmware/NON-NEGOTIABLES.md para el contrato completo que cualquier
// firmware nuevo debe respetar.
#include <string.h>
#include "nvs_flash.h"
#include "mqtt_client.h"
#include "esp_log.h"
#include "totem_core.h"

static const char *TAG = "bootstrap";
static esp_mqtt_client_handle_t mqtt_client = NULL;
static totem_config_t config;

// Topics MQTT — construidos después de cargar unit_id desde NVS
static char topic_ota[96];
static char topic_status[96];

static void mqtt_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t) data;

    switch (id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI(TAG, "MQTT conectado");
            esp_mqtt_client_subscribe(mqtt_client, topic_ota, 1);
            ESP_LOGI(TAG, "Suscrito a: %s", topic_ota);

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

            if (strcmp(topic, topic_ota) == 0) {
                ESP_LOGI(TAG, "Mensaje OTA recibido");
                totem_ota_handle_message(event->data, event->data_len);
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

void app_main(void)
{
    totem_rollback_init();

    ESP_ERROR_CHECK(nvs_flash_init());
    totem_config_load(&config);

    snprintf(topic_ota,    sizeof(topic_ota),    "totem/%s/ota",    config.unit_id);
    snprintf(topic_status, sizeof(topic_status), "totem/%s/status", config.unit_id);

    totem_wifi_connect(&config);
    mqtt_init();

    // Sin lógica propia — el dispositivo queda a la espera de un OTA hacia
    // un firmware con funcionalidad real. No hay sensores ni riego aquí.
}
