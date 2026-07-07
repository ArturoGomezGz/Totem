// Driver del sensor RQ-S003 (módulo REXQualis basado en DHT11, protocolo de
// un solo hilo). Independiente de totem_core — cualquier firmware que use
// este sensor lo declara en su REQUIRES; los que no (bootstrap, simulator)
// no lo arrastran.
#pragma once

#include "esp_err.h"
#include "driver/gpio.h"

// Configura el GPIO como entrada con pull-up y lo deja en alto (reposo).
// Llamar una vez en el arranque, antes de la primera lectura.
void totem_dht11_gpio_init(gpio_num_t gpio);

// Lee temperatura y humedad. El DHT11 no se puede leer más rápido que 1 vez
// por segundo — respetar ese mínimo entre llamadas.
esp_err_t totem_dht11_read(gpio_num_t gpio, float *temperature, float *humidity);
