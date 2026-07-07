#include "totem_core.h"

#include "esp_log.h"
#include "esp_system.h"
#include "nvs.h"

static const char *TAG = "totem_core";

void totem_config_load(totem_config_t *cfg)
{
    nvs_handle_t nvs;
    esp_err_t err = nvs_open("config", NVS_READONLY, &nvs);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "NVS no inicializado o namespace 'config' ausente (err 0x%x)", err);
        ESP_LOGE(TAG, "Provisionar el dispositivo: ver firmware/simulator/nvs_config.csv.example");
        esp_restart();
    }

    size_t len;

    len = sizeof(cfg->wifi_ssid);  ESP_ERROR_CHECK(nvs_get_str(nvs, "wifi_ssid", cfg->wifi_ssid, &len));
    len = sizeof(cfg->wifi_pass);  ESP_ERROR_CHECK(nvs_get_str(nvs, "wifi_pass", cfg->wifi_pass, &len));
    len = sizeof(cfg->mqtt_uri);   ESP_ERROR_CHECK(nvs_get_str(nvs, "mqtt_uri",  cfg->mqtt_uri,  &len));
    len = sizeof(cfg->unit_id);    ESP_ERROR_CHECK(nvs_get_str(nvs, "unit_id",   cfg->unit_id,   &len));
    len = sizeof(cfg->api_key);    ESP_ERROR_CHECK(nvs_get_str(nvs, "api_key",   cfg->api_key,   &len));

    nvs_close(nvs);

    ESP_LOGI(TAG, "Config cargada — unit_id: %s, broker: %s", cfg->unit_id, cfg->mqtt_uri);
}
