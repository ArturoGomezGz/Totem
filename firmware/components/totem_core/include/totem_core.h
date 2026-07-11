// Núcleo no-negociable compartido por todo firmware Totem que hable con el
// server: NVS, WiFi, OTA y rollback. Ver firmware/NON-NEGOTIABLES.md para el
// contrato completo — estas cinco piezas siempre viajan juntas (ningún
// proyecto real usa OTA sin rollback, ni MQTT sin reportar "status"), por
// eso son un solo componente y no cuatro independientes.
#pragma once

#include <stdbool.h>
#include "esp_err.h"
#include "mqtt_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

// Credenciales y datos de identidad cargados desde NVS (namespace "config").
typedef struct {
    char wifi_ssid[64];
    char wifi_pass[64];
    char mqtt_uri[128];
    char unit_id[64];
    char api_key[128];
} totem_config_t;

// Carga las cinco claves del namespace "config" en NVS_READONLY. Si el
// namespace no existe (unidad sin provisionar), loguea el error y reinicia.
void totem_config_load(totem_config_t *cfg);

// Conecta a WiFi (bloqueante) con reintentos, usando las credenciales de cfg.
void totem_wifi_connect(const totem_config_t *cfg);

// Versión del binario actual, tal como la incrusta ESP-IDF en el descriptor
// de la app a partir de version.txt. Nunca hardcodear la versión en el código.
const char *totem_firmware_version(void);

// Publica el payload de status ({"firmware_version": "..."}) con retain=1
// en topic_status. Debe llamarse una vez, justo tras MQTT_EVENT_CONNECTED.
void totem_publish_status(esp_mqtt_client_handle_t client, const char *topic_status);

// Debe llamarse en app_main, antes de wifi/mqtt: si la partición actual está
// pendiente de verificar tras un OTA, arranca el watchdog de rollback.
void totem_rollback_init(void);

// Debe llamarse en MQTT_EVENT_CONNECTED: si había un rollback pendiente,
// confirma la imagen como válida y cancela el watchdog.
void totem_rollback_confirm(void);

// True mientras una actualización OTA está en curso — los proyectos deben
// pausar su lógica de publicación periódica mientras esto sea cierto.
bool totem_ota_in_progress(void);

// Procesa un mensaje recibido en el topic "ota" ({"url","sha256","version"})
// y, si es válido, lanza la tarea de descarga/verificación/aplicación.
void totem_ota_handle_message(const char *data, int data_len);

// ============================================================
// LED de estado — RGB WS2812 integrado en GPIO8 (ESP32-C6 SuperMini)
// ============================================================
// Ver docs/capa1/totem-principal/sistema-decision/modulo-decision.md y
// firmware/NON-NEGOTIABLES.md § LED de estado. Vive en totem_core porque
// GPIO8 es un recurso de la placa física, no un periférico opcional por
// proyecto — a diferencia de los LEDs de bomba/válvula de `genesis`.

// Debe llamarse una vez en app_main antes de cualquier otro uso.
void totem_status_led_init(void);

// Encendido/apagado fijo, para operaciones de duración variable (ej. OTA:
// encendido mientras dura la descarga/flasheo real, no un tiempo fijo).
void totem_status_led_on(void);
void totem_status_led_off(void);

// Encendido por `ms`, luego apagado — no bloquea al llamador (corre en una
// tarea propia). Usado para confirmaciones puntuales de duración fija.
void totem_status_led_pulse(int ms);

// Igual que totem_status_led_pulse, pero además hace xTaskNotifyGive()
// sobre `task_to_notify` justo en el instante en que el LED se apaga — así
// el llamador puede sincronizar algo (ej. "el ciclo de decisión empieza de
// 0") con ese instante exacto en vez de con el momento en que se recibió
// el cambio. `task_to_notify` puede ser NULL (equivalente a pulse simple).
void totem_status_led_pulse_notify(int ms, TaskHandle_t task_to_notify);
