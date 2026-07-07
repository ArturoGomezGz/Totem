#include "totem_dht11.h"

#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"

#define DHT_TIMEOUT_US 1000

static const char *TAG = "totem_dht11";
static portMUX_TYPE dht_mux = portMUX_INITIALIZER_UNLOCKED;

// Etapas del protocolo, usadas solo para diagnóstico cuando falla.
enum {
    DHT_STAGE_OK = 0,
    DHT_STAGE_RESP_LOW,   // el sensor nunca baja la línea tras la señal de inicio
    DHT_STAGE_RESP_HIGH,  // el sensor bajó pero nunca sube (fin del pulso de 80us bajo)
    DHT_STAGE_RESP_LOW2,  // el sensor no vuelve a bajar tras el pulso de 80us alto
    DHT_STAGE_BIT_HIGH,   // timeout esperando el inicio (flanco alto) de un bit de dato
    DHT_STAGE_BIT_LOW,    // timeout esperando el fin (flanco bajo) de un bit de dato
};

// Espera a que la línea alcance el nivel esperado, con timeout en microsegundos.
// Devuelve el tiempo transcurrido (útil para medir el ancho de los pulsos de
// dato), o -1 si se agotó el timeout.
static int64_t dht_wait_level(gpio_num_t gpio, int level, int64_t timeout_us)
{
    int64_t start = esp_timer_get_time();
    while (gpio_get_level(gpio) != level) {
        if (esp_timer_get_time() - start > timeout_us) {
            return -1;
        }
    }
    return esp_timer_get_time();
}

void totem_dht11_gpio_init(gpio_num_t gpio)
{
    gpio_config_t dht_cfg = {
        .pin_bit_mask = 1ULL << gpio,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
    };
    gpio_config(&dht_cfg);

    gpio_set_level(gpio, 1);
}

esp_err_t totem_dht11_read(gpio_num_t gpio, float *temperature, float *humidity)
{
    uint8_t data[5] = {0};
    esp_err_t err = ESP_OK;
    int fail_stage = DHT_STAGE_OK;
    int fail_bit = -1;

    // Nivel de la línea en reposo justo antes de iniciar — si no está en
    // alto (pull-up del módulo sosteniéndola), algo la está reteniendo baja
    // (cableado en corto, GND cruzado con DATA, módulo sin alimentación).
    int idle_level = gpio_get_level(gpio);

    // Señal de inicio: el maestro baja la línea >=18ms y la libera.
    //
    // OJO con el tick de FreeRTOS: con CONFIG_FREERTOS_HZ=100 (tick de 10ms),
    // pdMS_TO_TICKS(18) se TRUNCA por división entera a 1 tick = 10ms, muy por
    // debajo del mínimo de 18ms que exige el DHT11 — el sensor nunca reconoce
    // la señal de inicio y jamás responde (timeout en 'sin-respuesta(bajo)').
    // Se usa un busy-wait preciso de 20ms, independiente del tick, para
    // garantizar el mínimo sin importar CONFIG_FREERTOS_HZ. Va fuera de la
    // sección crítica, así que WiFi/MQTT siguen atendiéndose durante la espera.
    gpio_set_direction(gpio, GPIO_MODE_OUTPUT);
    gpio_set_level(gpio, 0);
    esp_rom_delay_us(20000);

    // A partir de aquí el protocolo depende de pulsos de 26-70us — si el
    // scheduler o una ISR de WiFi nos quita la CPU en este tramo (~5ms),
    // perdemos la ventana de respuesta del sensor y todo el resto de la
    // lectura hace timeout aunque el DHT11 sí haya respondido a tiempo. Se
    // deshabilitan interrupciones/scheduler para todo el tramo de timing.
    portENTER_CRITICAL(&dht_mux);

    gpio_set_level(gpio, 1);
    esp_rom_delay_us(30);
    gpio_set_direction(gpio, GPIO_MODE_INPUT);

    // Respuesta del sensor: 80us bajo + 80us alto antes de los datos
    if (dht_wait_level(gpio, 0, DHT_TIMEOUT_US) < 0) { err = ESP_ERR_TIMEOUT; fail_stage = DHT_STAGE_RESP_LOW; goto done; }
    if (dht_wait_level(gpio, 1, DHT_TIMEOUT_US) < 0) { err = ESP_ERR_TIMEOUT; fail_stage = DHT_STAGE_RESP_HIGH; goto done; }
    if (dht_wait_level(gpio, 0, DHT_TIMEOUT_US) < 0) { err = ESP_ERR_TIMEOUT; fail_stage = DHT_STAGE_RESP_LOW2; goto done; }

    // 40 bits de datos: cada bit empieza con ~50us bajo, seguido de un nivel
    // alto cuya duración codifica el valor (~26-28us = '0', ~70us = '1')
    for (int i = 0; i < 40; i++) {
        if (dht_wait_level(gpio, 1, DHT_TIMEOUT_US) < 0) { err = ESP_ERR_TIMEOUT; fail_stage = DHT_STAGE_BIT_HIGH; fail_bit = i; goto done; }
        int64_t high_start = esp_timer_get_time();
        if (dht_wait_level(gpio, 0, DHT_TIMEOUT_US) < 0) { err = ESP_ERR_TIMEOUT; fail_stage = DHT_STAGE_BIT_LOW; fail_bit = i; goto done; }
        int64_t high_len = esp_timer_get_time() - high_start;

        data[i / 8] <<= 1;
        if (high_len > 40) {
            data[i / 8] |= 1;
        }
    }

done:
    portEXIT_CRITICAL(&dht_mux);

    if (err != ESP_OK) {
        static const char *stage_name[] = {
            "ok", "sin-respuesta(bajo)", "sin-respuesta(alto)", "sin-respuesta(bajo2)",
            "bit-flanco-alto", "bit-flanco-bajo",
        };
        char bit_info[16] = "";
        if (fail_bit >= 0) {
            snprintf(bit_info, sizeof(bit_info), " (bit %d)", fail_bit);
        }
        ESP_LOGW(TAG, "DHT11: timeout en etapa '%s'%s — linea en reposo antes de iniciar: %s, bytes parciales: %02x %02x %02x %02x %02x",
            stage_name[fail_stage], bit_info,
            idle_level ? "alto (normal)" : "BAJO (posible corto/sin pull-up)",
            data[0], data[1], data[2], data[3], data[4]);
        return err;
    }

    uint8_t checksum = (uint8_t)(data[0] + data[1] + data[2] + data[3]);
    if (checksum != data[4]) {
        ESP_LOGW(TAG, "DHT11: checksum inválido (esperado %02x, calculado %02x)", data[4], checksum);
        return ESP_ERR_INVALID_CRC;
    }

    // El DHT11 reporta enteros — data[1] y data[3] (partes decimales) son
    // siempre 0 en este modelo, a diferencia del DHT22.
    *humidity    = (float)data[0];
    *temperature = (float)data[2];
    return ESP_OK;
}
