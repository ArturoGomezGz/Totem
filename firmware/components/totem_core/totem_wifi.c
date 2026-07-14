#include "totem_core.h"

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_wifi.h"

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

// Reintentos rápidos antes de LIBERAR EL ARRANQUE en modo offline. NO es un
// tope de reconexión: tras liberarse el arranque se sigue reintentando
// indefinidamente con backoff (ver el reprograma de reconexión más abajo).
// Antes existía un WIFI_MAX_RETRIES=5 que, al agotarse, dejaba de llamar a
// esp_wifi_connect() PARA SIEMPRE — así, si el AP (p.ej. un hotspot) caía y
// volvía, el ESP32 no reintentaba nunca y sólo un reset físico lo recuperaba.
#define WIFI_BOOT_RETRIES    5

// Backoff exponencial de reconexión (techo). Los primeros reintentos van al
// mínimo para no demorar ni el arranque ni la recuperación de un corte breve;
// si el AP sigue ausente el intervalo crece hasta el techo para no martillar
// la radio ni el log mientras no haya nada a lo que conectarse.
#define WIFI_BACKOFF_MIN_MS  2000
#define WIFI_BACKOFF_MAX_MS  30000

static const char *TAG = "totem_wifi";
static EventGroupHandle_t wifi_events;

// Reintentos desde el último GOT_IP. Se resetea a 0 al obtener IP; a diferencia
// del código anterior, agotarlo NO detiene la reconexión, sólo libera el
// arranque una vez.
static int  retry_count   = 0;
static int  backoff_ms    = WIFI_BACKOFF_MIN_MS;
static bool boot_released = false;   // ya se soltó el wait bloqueante inicial

// Timer one-shot para espaciar los reintentos de esp_wifi_connect() con backoff
// sin bloquear el bucle de eventos por defecto (no se puede hacer vTaskDelay
// dentro del handler de eventos).
static esp_timer_handle_t reconnect_timer = NULL;

static void reconnect_timer_cb(void *arg)
{
    esp_wifi_connect();
}

static void schedule_reconnect(int delay_ms)
{
    // Rearmar el one-shot: si ya estaba corriendo hay que pararlo primero
    // (start_once sobre un timer activo devuelve error). Ambos errores de
    // estado inválido son benignos aquí.
    esp_timer_stop(reconnect_timer);
    esp_timer_start_once(reconnect_timer, (uint64_t)delay_ms * 1000);
}

static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        retry_count++;

        // Liberar el arranque tras unos reintentos rápidos: app_main no puede
        // quedarse bloqueada para siempre si el AP no está al encender. El
        // firmware sigue operando offline (perfil cacheado en NVS) y la
        // reconexión continúa en segundo plano indefinidamente.
        if (!boot_released && retry_count >= WIFI_BOOT_RETRIES) {
            boot_released = true;
            xEventGroupSetBits(wifi_events, WIFI_FAIL_BIT);
        }

        // Reprograma SIEMPRE la reconexión (aquí estaba el bug: antes se dejaba
        // de reintentar). Reintentos rápidos durante el arranque; backoff
        // exponencial una vez liberado, si el AP sigue ausente.
        int delay_ms = boot_released ? backoff_ms : WIFI_BACKOFF_MIN_MS;
        schedule_reconnect(delay_ms);
        if (boot_released) {
            backoff_ms *= 2;
            if (backoff_ms > WIFI_BACKOFF_MAX_MS) backoff_ms = WIFI_BACKOFF_MAX_MS;
        }
        ESP_LOGW(TAG, "WiFi desconectado — reintento #%d en %d ms", retry_count, delay_ms);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *) data;
        ESP_LOGI(TAG, "IP obtenida: " IPSTR, IP2STR(&event->ip_info.ip));
        retry_count   = 0;
        backoff_ms    = WIFI_BACKOFF_MIN_MS;   // resetea el backoff para el próximo corte
        boot_released = true;
        esp_timer_stop(reconnect_timer);        // cancela cualquier reintento pendiente
        xEventGroupSetBits(wifi_events, WIFI_CONNECTED_BIT);
    }
}

void totem_wifi_connect(const totem_config_t *cfg)
{
    wifi_events = xEventGroupCreate();

    const esp_timer_create_args_t timer_args = {
        .callback = reconnect_timer_cb,
        .name     = "wifi_reconnect",
    };
    ESP_ERROR_CHECK(esp_timer_create(&timer_args, &reconnect_timer));

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL, NULL));

    wifi_config_t wifi_config = {};
    strncpy((char *)wifi_config.sta.ssid,     cfg->wifi_ssid, sizeof(wifi_config.sta.ssid));
    strncpy((char *)wifi_config.sta.password, cfg->wifi_pass, sizeof(wifi_config.sta.password));

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    // Bloquea el arranque hasta la primera conexión O hasta agotar los
    // reintentos rápidos (modo offline). Pase lo que pase, la reconexión sigue
    // viva en segundo plano vía el handler de eventos.
    EventBits_t bits = xEventGroupWaitBits(wifi_events,
        WIFI_CONNECTED_BIT | WIFI_FAIL_BIT, pdFALSE, pdFALSE, portMAX_DELAY);

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "WiFi conectado");
    } else {
        ESP_LOGW(TAG, "WiFi no disponible al arrancar — se continúa offline, reconexión en segundo plano");
    }
}
