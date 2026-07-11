// LED de estado — RGB WS2812 integrado en GPIO8 (ESP32-C6 SuperMini). Ver
// declaración/razón de estar en totem_core en include/totem_core.h.
#include "totem_core.h"

#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "led_strip.h"

#define STATUS_LED_GPIO GPIO_NUM_8

// Azul tenue — no se confunde con las alertas rojas/verdes de otros
// proyectos (ej. LEDs de flotador en genesis) ni encandila de noche.
#define STATUS_LED_R 0
#define STATUS_LED_G 0
#define STATUS_LED_B 40

static const char *TAG = "totem_led";
static led_strip_handle_t led_strip = NULL;

void totem_status_led_init(void)
{
    led_strip_config_t strip_config = {
        .strip_gpio_num = STATUS_LED_GPIO,
        .max_leds       = 1,
    };
    led_strip_rmt_config_t rmt_config = {
        .resolution_hz = 10 * 1000 * 1000,
    };
    esp_err_t err = led_strip_new_rmt_device(&strip_config, &rmt_config, &led_strip);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "No se pudo inicializar el LED de estado (%s) — el firmware sigue sin indicador visual",
            esp_err_to_name(err));
        led_strip = NULL;
        return;
    }
    led_strip_clear(led_strip);
}

void totem_status_led_on(void)
{
    if (!led_strip) return;
    led_strip_set_pixel(led_strip, 0, STATUS_LED_R, STATUS_LED_G, STATUS_LED_B);
    led_strip_refresh(led_strip);
}

void totem_status_led_off(void)
{
    if (!led_strip) return;
    led_strip_clear(led_strip);
}

typedef struct {
    int ms;
    TaskHandle_t notify;
} led_pulse_params_t;

static void led_pulse_task(void *pvParameters)
{
    led_pulse_params_t *p = (led_pulse_params_t *)pvParameters;

    totem_status_led_on();
    vTaskDelay(pdMS_TO_TICKS(p->ms));
    totem_status_led_off();

    if (p->notify) {
        xTaskNotifyGive(p->notify);
    }

    free(p);
    vTaskDelete(NULL);
}

void totem_status_led_pulse_notify(int ms, TaskHandle_t task_to_notify)
{
    led_pulse_params_t *p = malloc(sizeof(led_pulse_params_t));
    if (!p) {
        ESP_LOGW(TAG, "Sin memoria para el pulso del LED de estado");
        return;
    }
    p->ms     = ms;
    p->notify = task_to_notify;
    xTaskCreate(led_pulse_task, "led_pulse", 2048, p, 5, NULL);
}

void totem_status_led_pulse(int ms)
{
    totem_status_led_pulse_notify(ms, NULL);
}
