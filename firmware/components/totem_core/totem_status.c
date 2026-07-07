#include "totem_core.h"

#include <stdio.h>
#include "esp_log.h"
#include "esp_ota_ops.h"

static const char *TAG = "totem_status";

// Versión de este binario — viene de version.txt (ver raíz del proyecto),
// incrustada por ESP-IDF en el descriptor de la app en tiempo de build.
// El server la extrae de los mismos bytes del .bin al publicarlo, así que
// nunca puede desincronizarse de lo que el dispositivo realmente reporta.
const char *totem_firmware_version(void)
{
    return esp_ota_get_app_description()->version;
}

void totem_publish_status(esp_mqtt_client_handle_t client, const char *topic_status)
{
    char payload[64];
    snprintf(payload, sizeof(payload), "{\"firmware_version\":\"%s\"}", totem_firmware_version());
    // retain=1 — el server debe conocer la última versión reportada aunque
    // se reinicie y se resuscriba después de que el dispositivo publicó esto.
    esp_mqtt_client_publish(client, topic_status, payload, 0, 1, 1);
    ESP_LOGI(TAG, "Version reportada al servidor: %s", totem_firmware_version());
}
