#include "totem_core.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_ota_ops.h"

// Margen para confirmar que el firmware recién aplicado por OTA arrancó bien
// (WiFi + MQTT) antes de que el bootloader lo revierta automáticamente.
#define ROLLBACK_CONFIRM_TIMEOUT_MS 90000

static const char *TAG = "totem_rollback";
static volatile bool pending_rollback_confirm = false;

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

void totem_rollback_init(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    ESP_LOGI(TAG, "Arrancando desde partición: %s (firmware %s)", running->label, totem_firmware_version());

    esp_ota_img_states_t ota_state;
    if (esp_ota_get_state_partition(running, &ota_state) == ESP_OK
        && ota_state == ESP_OTA_IMG_PENDING_VERIFY) {
        ESP_LOGW(TAG, "Particion pendiente de verificar tras OTA — confirmando al conectar a MQTT");
        pending_rollback_confirm = true;
        xTaskCreate(rollback_watchdog_task, "rollback_wd", 2048, NULL, 5, NULL);
    }
}

void totem_rollback_confirm(void)
{
    // Llegar hasta aqui prueba que WiFi + credenciales MQTT del firmware
    // nuevo funcionan de punta a punta — seguro confirmar.
    if (pending_rollback_confirm) {
        esp_ota_mark_app_valid_cancel_rollback();
        pending_rollback_confirm = false;
        ESP_LOGI(TAG, "Firmware %s confirmado como valido - rollback cancelado", totem_firmware_version());
    }
}
