#include "totem_core.h"

#include <string.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_http_client.h"
#include "cJSON.h"
#include "mbedtls/md.h"

#define OTA_BUF_SIZE 4096

static const char *TAG = "totem_ota";
static volatile bool ota_in_progress = false;

bool totem_ota_in_progress(void)
{
    return ota_in_progress;
}

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
    totem_status_led_off();
    free(params);
    ota_in_progress = false;
    vTaskDelete(NULL);
}

void totem_ota_handle_message(const char *data, int data_len)
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
    // Encendido fijo mientras dura la descarga/flasheo real (duración
    // variable, no un pulso de tiempo fijo) — se apaga en ota_fail si algo
    // sale mal; en éxito, el reinicio corta la alimentación de la tarea y
    // el LED se apaga con él.
    totem_status_led_on();
    xTaskCreate(ota_task, "ota_task", 8192, params, 5, NULL);
}
