#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_random.h"
#include "nvs_flash.h"
#include "mqtt_client.h"

#define WIFI_SSID          "IoT"
#define WIFI_PASSWORD      "Plata54321"

#define MQTT_BROKER_URI    "mqtt://10.120.154.220:1883"
#define MQTT_USERNAME      "sim-001"
#define MQTT_PASSWORD      "nueva-password"
#define UNIT_ID            "sim-001"

#define TOPIC_READINGS     "totem/" UNIT_ID "/readings"
#define TOPIC_COMMANDS     "totem/" UNIT_ID "/commands"

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
#define WIFI_MAX_RETRIES   5

static const char *TAG = "simulator";
static EventGroupHandle_t wifi_events;
static int retry_count = 0;
static esp_mqtt_client_handle_t mqtt_client = NULL;

// --- WiFi ---

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

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASSWORD,
        },
    };

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    EventBits_t bits = xEventGroupWaitBits(wifi_events, WIFI_CONNECTED_BIT | WIFI_FAIL_BIT, pdFALSE, pdFALSE, portMAX_DELAY);

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "WiFi conectado");
    } else {
        ESP_LOGE(TAG, "Fallo al conectar a WiFi");
    }
}

// --- MQTT ---

static void mqtt_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t) data;

    switch (id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI(TAG, "MQTT conectado");
            esp_mqtt_client_subscribe(mqtt_client, TOPIC_COMMANDS, 1);
            ESP_LOGI(TAG, "Suscrito a: %s", TOPIC_COMMANDS);
            break;

        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGW(TAG, "MQTT desconectado");
            break;

        case MQTT_EVENT_DATA:
            ESP_LOGI(TAG, "Comando recibido en [%.*s]: %.*s",
                event->topic_len, event->topic,
                event->data_len, event->data);
            break;

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
        .broker.address.uri    = MQTT_BROKER_URI,
        .credentials.username  = MQTT_USERNAME,
        .credentials.authentication.password = MQTT_PASSWORD,
        .credentials.client_id = UNIT_ID,
    };

    mqtt_client = esp_mqtt_client_init(&cfg);
    esp_mqtt_client_register_event(mqtt_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    esp_mqtt_client_start(mqtt_client);
}

// --- Tarea de publicacion de lecturas simuladas ---

static void publish_readings_task(void *pvParameters)
{
    float temperature = 22.0f;
    float humidity    = 65.0f;
    float light       = 300.0f;

    char payload[128];

    while (1) {
        // Variacion sintetica leve
        temperature += ((float)(esp_random() % 10) - 5) * 0.1f;
        humidity    += ((float)(esp_random() % 10) - 5) * 0.2f;
        light       += ((float)(esp_random() % 20) - 10) * 1.0f;

        snprintf(payload, sizeof(payload),
            "{\"temperature\":%.1f,\"humidity\":%.1f,\"light\":%.1f}",
            temperature, humidity, light);

        int msg_id = esp_mqtt_client_publish(mqtt_client, TOPIC_READINGS, payload, 0, 1, 0);
        ESP_LOGI(TAG, "Lectura publicada (msg_id=%d): %s", msg_id, payload);

        vTaskDelay(pdMS_TO_TICKS(10000));
    }
}

// --- Entry point ---

void app_main(void)
{
    ESP_ERROR_CHECK(nvs_flash_init());
    wifi_init();
    mqtt_init();

    // Espera a que MQTT conecte antes de empezar a publicar
    vTaskDelay(pdMS_TO_TICKS(2000));

    xTaskCreate(publish_readings_task, "readings", 4096, NULL, 5, NULL);
}
