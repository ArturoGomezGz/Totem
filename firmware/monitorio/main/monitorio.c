// Firmware monitorio (1.4.x) — riego por timer fijo, sin sensores.
//
// Replica el funcionamiento de firmware/genesis (perfil de cultivo, decisión
// de riego autónoma, módulo de suministro con flotador/válvula/bomba, auditoría
// de eventos, buffer offline, OTA/rollback) pero DELIBERADAMENTE RECORTADO:
//
//   - Sensores de gas: metano (MQ-4) y calidad de aire (Grove v1.3), analógicos
//     por ADC (conteo crudo), y CO2 (Senseair S8, NDIR) por UART/Modbus (ppm
//     calibrados). Solo monitoreo — NO alimentan la decisión de riego. No lee
//     DHT11 (temperatura/humedad) ni LDR (luz).
//   - SIN cálculo de VPD: el único método de riego soportado es `fixed_timer`.
//     `vpd_threshold` no existe aquí (se ignora si llegara en un perfil).
//   - Publica una lectura a `readings` cada 10 s (metano, calidad de aire y CO2;
//     y de paso mantiene viva la señal en el dashboard; el server refresca
//     last_seen con readings/events, y el frontend marca "sin señal" a los 35 s).
//
// Todo lo demás es el mismo modelo que genesis:
//
// ============================================================
// Coordinación de riego — una sola tarea dueña, manejada por eventos
// ============================================================
// La decisión de riego (cuándo y cuánto) y la actuación física (flotador,
// válvula, bomba) viven en UNA sola tarea (irrigation_task), dueña de: perfil
// activo, máquina de estados del suministro, bomba/válvula y decisión. El
// handler MQTT solo PUBLICA eventos en irrig_queue; nunca toca actuadores ni
// estado de riego. Al ser un único hilo el que muta ese estado, no hay carreras.
//
// WiFi/NVS/OTA/rollback/status/LED de estado vienen de
// firmware/components/totem_core — ver firmware/NON-NEGOTIABLES.md.
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "driver/uart.h"
#include "esp_adc/adc_oneshot.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "mqtt_client.h"
#include "cJSON.h"
#include "totem_core.h"

// ============================================================
// Actuadores — mismos pines que firmware/genesis (cableado intercambiable)
// ============================================================
//
// Mapeo físico sobre el board ESP32-C6 SuperMini (headers leídos del
// silkscreen). GPIO8 (LED RGB WS2812) y GPIO9 (BOOT) van integrados y los usa
// totem_core (LED de estado) — no se tocan aquí.
//   - PUMP_LED_GPIO: LED que simula la bomba (encendido = regando).
//   - VALVE_LED_GPIO: LED que simula la válvula NC (encendido = abierta).
//   - FLOAT_SWITCH_GPIO: flotador real (interruptor mecánico) con pull-up
//     interno. Cierra el circuito (conduce) cuando está ABAJO y lo abre cuando
//     está ARRIBA: LOW = flotador abajo (solución insuficiente), HIGH = arriba.
#define PUMP_LED_GPIO       GPIO_NUM_5
#define VALVE_LED_GPIO      GPIO_NUM_2
#define FLOAT_SWITCH_GPIO   GPIO_NUM_3

// ============================================================
// Sensores de gas — metano (MQ-4) y calidad de aire (Grove v1.3)
// ============================================================
// Fase de prueba, SOLO monitoreo (no alimentan la decisión de riego). Ambos son
// analógicos y en el ESP32-C6 el ADC solo existe en GPIO0-GPIO6 (un solo ADC,
// ADC1), así que van forzosamente en pines de ese rango:
//   - METHANE (MQ-4, pin AO): concentración de metano. Solo se usa la salida
//     analógica; la digital (DO, umbral por potenciómetro) se ignora — el umbral
//     se aplicaría en software. GPIO0 = ADC1_CHANNEL_0.
//   - AIR_QUALITY (Grove Air Quality Sensor v1.3, pin SIG): índice genérico de
//     calidad de aire (sensor resistivo no selectivo). GPIO1 = ADC1_CHANNEL_1,
//     libre en monitorio (era el LDR en genesis), sin función de strapping.
// Ninguno toca los pines de riego (bomba GPIO5 / válvula GPIO2 / flotador GPIO3).
//
// Ambos publican el conteo CRUDO del ADC (0-4095) sin calibrar — igual criterio
// que el LDR/gases de genesis; la conversión a unidades reales queda para después.
//
// CAVEAT de hardware: la salida analógica puede llegar hasta el voltaje de
// alimentación del módulo. Alimentar a 3V3 (o usar un divisor en la salida): con
// 5V puede superar los 3.3V máximos del pin ADC y dañarlo. El MQ-4 necesita
// precalentamiento — los primeros minutos las lecturas no son fiables.
#define METHANE_ADC_CHANNEL     ADC_CHANNEL_0
#define METHANE_GPIO            GPIO_NUM_0
#define AIR_QUALITY_ADC_CHANNEL ADC_CHANNEL_1
#define AIR_QUALITY_GPIO        GPIO_NUM_1

// ============================================================
// Sensor de CO2 — Senseair S8 (NDIR) por UART/Modbus
// ============================================================
// A diferencia del MQ-4/Grove (analógicos, conteo crudo del ADC), el S8 es
// DIGITAL: entrega ppm ya CALIBRADOS por UART (9600 8N1, lógica 3.3V) usando
// Modbus. Se lee un único input register (IR4, dirección 0x0003) con función
// 0x04. La trama de petición es constante (8 bytes, CRC ya precalculado); de la
// respuesta (7 bytes) se valida el CRC16-Modbus y se extrae el CO2 big-endian.
//
// UART_NUM_1 (UART0 es la consola). No usa ADC, así que los pines son libres del
// rango alto del SuperMini:
//   - S8_TX_GPIO (ESP TX) -> R (RxD) del S8
//   - S8_RX_GPIO (ESP RX) <- T (TxD) del S8
// Cruce obligado: el TX de un lado va al RX del otro. Si el sensor no responde,
// invertir R/T no daña nada (lógica 3.3V) — es lo primero a probar.
//
// CAVEAT de hardware: el S8 se alimenta a 5V (4.5-5.25V) y da picos de ~300 mA
// al medir. Poner un cap de desacople (~100 uF) entre G+ y G0, pegado al sensor,
// para que el pico no hunda el riel y resetee el ESP (brownout). El TxD del S8 es
// TTL 3.3V, seguro para el ESP directo — no necesita divisor (a diferencia del AO
// del MQ-4). ABC (autocalibración) se deja en fábrica en esta fase de prueba.
#define S8_UART_PORT   UART_NUM_1
#define S8_TX_GPIO     GPIO_NUM_4    // ESP TX -> S8 R (RxD)
#define S8_RX_GPIO     GPIO_NUM_14   // ESP RX <- S8 T (TxD)
#define S8_UART_BAUD   9600

// Cadencia de "housekeeping" del ciclo de decisión — aplica cuando NO hay
// perfil activo. fixed_timer NO usa esto: su periodo se deriva de min_interval_s
// (ver schedule_next_decision).
#define HOUSEKEEPING_INTERVAL_MS (60 * 1000)

// Primera evaluación de riego tras el arranque — margen para que el perfil
// retenido (topic `profile`) llegue por MQTT antes de la primera decisión.
#define FIRST_DECISION_DELAY_MS  (15 * 1000)

// Cadencia de sondeo del suministro mientras se riega (llenando o bombeando):
// cada cuánto se re-chequea el flotador y se acumula el tiempo real de bomba.
#define SUPPLY_POLL_MS           200

// Cadencia de publicación de lecturas (metano) a `readings` — mismo intervalo
// que las lecturas de genesis. Además mantiene last_seen fresco en el server
// (< OFFLINE_MS del frontend, 35 s), evitando el "sin señal".
#define READINGS_INTERVAL_MS     (10 * 1000)

// Namespace/clave NVS donde se cachea el último perfil recibido (crudo, tal
// cual llega por MQTT) — ver docs/transversal/crop-profile.md: el ESP32
// siempre debe poder decidir con el último perfil conocido, incluso offline.
#define PROFILE_NVS_NAMESPACE "profile"
#define PROFILE_NVS_KEY       "json"
#define PROFILE_JSON_MAX_LEN  512

static const char *TAG = "monitorio";
static esp_mqtt_client_handle_t mqtt_client = NULL;

// Estado de la conexión MQTT, escrito por el handler de eventos y leído por
// heartbeat_task e irrigation_task. Carrera benigna.
static volatile bool mqtt_connected = false;

// Espejos de estado solo para logging — los escribe pump_set/valve_set (dentro
// de irrigation_task) y los lee el heartbeat. Carrera benigna: es un log.
static volatile bool pump_on = false;
static volatile bool valve_open = false;

static totem_config_t config;
static adc_oneshot_unit_handle_t adc1_handle;

// ============================================================
// Perfil de cultivo activo (struct) — POD, se copia por valor
// ============================================================
// Solo los campos que usa fixed_timer. Sin light_min/max, sin threshold_vpd ni
// base_duration (eran de vpd_threshold, que este firmware no soporta).

typedef struct {
    bool  loaded;
    char  irrigation_method[32];
    float cycle_duration_s;   // cuánto riega cada ciclo
    float min_interval_s;     // periodo completo inicio-a-inicio del ciclo
} crop_profile_t;

// ============================================================
// Eventos hacia irrigation_task
// ============================================================
// Único canal por el que el handler MQTT se comunica con la tarea de riego.

typedef enum {
    IRRIG_EV_PROFILE,     // perfil nuevo recibido/parseado
    IRRIG_EV_MANUAL_ON,   // comando manual pump_on
    IRRIG_EV_MANUAL_OFF,  // comando manual pump_off
} irrig_ev_type_t;

typedef struct {
    irrig_ev_type_t type;
    crop_profile_t  profile;   // válido solo para IRRIG_EV_PROFILE
} irrig_ev_t;

static QueueHandle_t irrig_queue = NULL;

// Perfil cargado desde NVS en app_main y entregado a irrigation_task como
// pvParameters (no por la cola — se aplica una sola vez, en el init de la
// tarea). Estático: su dirección sobrevive a que app_main retorne.
static crop_profile_t boot_profile;
static bool           boot_profile_valid = false;

// Topics MQTT — construidos después de cargar unit_id desde NVS
static char topic_readings[96];
static char topic_commands[96];
static char topic_events[96];
static char topic_ota[96];
static char topic_profile[96];
static char topic_status[96];

// ============================================================
// Módulo de suministro — flotador, válvula NC (LED) y bomba (LED)
// ============================================================

static void actuators_init(void)
{
    gpio_config_t out_cfg = {
        .pin_bit_mask = (1ULL << PUMP_LED_GPIO) | (1ULL << VALVE_LED_GPIO),
        .mode         = GPIO_MODE_OUTPUT,
    };
    gpio_config(&out_cfg);
    gpio_set_level(PUMP_LED_GPIO, 0);
    gpio_set_level(VALVE_LED_GPIO, 0);

    gpio_config_t float_cfg = {
        .pin_bit_mask = 1ULL << FLOAT_SWITCH_GPIO,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
    };
    gpio_config(&float_cfg);
}

// true = flotador arriba (solución suficiente). El flotador corta el circuito
// al subir, así que con el pull-up interno arriba = HIGH.
static bool float_switch_up(void)
{
    return gpio_get_level(FLOAT_SWITCH_GPIO) == 1;
}

static void pump_set(bool on)
{
    pump_on = on;
    gpio_set_level(PUMP_LED_GPIO, on ? 1 : 0);
}

static void valve_set(bool open)
{
    valve_open = open;
    gpio_set_level(VALVE_LED_GPIO, open ? 1 : 0);
}

// ============================================================
// Estado de riego — TODO propiedad exclusiva de irrigation_task
// ============================================================
// Estas variables solo se leen/escriben desde el contexto de irrigation_task.
// Por eso NO son volatile ni llevan sincronización: un único hilo las toca.

typedef enum {
    SUPPLY_OFF,        // bomba y válvula apagadas
    SUPPLY_SUPPLYING,  // válvula NC abierta, esperando a que el flotador suba
    SUPPLY_PUMP_ON,    // solución suficiente, bomba regando
} supply_state_t;

static supply_state_t supply_state = SUPPLY_OFF;

typedef enum {
    OWNER_NONE,     // nadie riega
    OWNER_MANUAL,   // un comando manual tiene el control (riega hasta pump_off)
    OWNER_AUTO,     // el ciclo automático tiene el control (riega hasta cumplir duración)
} irrig_owner_t;

static irrig_owner_t owner = OWNER_NONE;

// Perfil activo — copia local de la tarea (nadie más lo lee).
static crop_profile_t profile = { .loaded = false };

// --- Contabilización de tiempo REAL de bomba encendida ---
// Un ciclo automático termina cuando el tiempo acumulado con la bomba
// efectivamente encendida alcanza target_pump_on_s, no cuando pasó ese tiempo
// de reloj. Si el flotador baja a mitad de riego, la bomba se apaga, se abre la
// válvula, y el acumulador se pausa hasta que vuelva a bombear.
static float   target_pump_on_s = 0.0f;   // objetivo del ciclo automático
static int64_t pumped_us_accum  = 0;      // us bombeados acumulados en el ciclo actual
static int64_t pump_on_since_us = 0;      // instante de encendido (0 = bomba apagada)

// Instante de apertura de la válvula NC (0 = cerrada). Mide la duración exacta
// de cada tramo de llenado para el evento de auditoría valve_close.
static int64_t valve_open_since_us = 0;

// Cooldown: instante real del fin del último riego (sellado en la transición a
// SUPPLY_OFF). Un riego manual también lo sella.
static int64_t last_watering_end_us = 0;
static bool    has_watered_since_boot = false;

// Deadline ABSOLUTO de la próxima decisión automática. Absoluto (no relativo)
// para que los eventos que despiertan la cola no adelanten la decisión.
static int64_t next_decision_us = 0;

// Nivel físico de cada actuador para un estado de suministro dado. Se usa para
// derivar, por diferencia entre el estado anterior y el nuevo, qué eventos de
// auditoría generó la transición — ver set_supply.
static void supply_levels(supply_state_t s, bool *valve, bool *pump)
{
    *valve = (s == SUPPLY_SUPPLYING);   // válvula NC abierta solo mientras se llena
    *pump  = (s == SUPPLY_PUMP_ON);     // bomba encendida solo al bombear
}

// Estado del suministro tal como lo consume la vista en vivo del dashboard.
static const char *supply_state_str(supply_state_t s)
{
    switch (s) {
        case SUPPLY_SUPPLYING: return "supplying";
        case SUPPLY_PUMP_ON:   return "pump_on";
        case SUPPLY_OFF:
        default:               return "off";
    }
}

// ============================================================
// Buffer offline de eventos de auditoría — cola FIFO en RAM
// ============================================================
// Los eventos de actuador (pump_on/off, valve_open/close) ocurridos durante una
// desconexión se encolan aquí y se vuelcan al reconectar con "age_s", para no
// perder la auditoría de riego. Lo posee EXCLUSIVAMENTE irrigation_task.
#define EVENT_BUF_CAP 256

typedef struct {
    int64_t capture_us;
    char    type[16];       // "pump_on" / "pump_off" / "valve_open" / "valve_close"
    bool    override;       // true = trigger "override" (manual); false = "autonomous"
    bool    has_duration;   // solo los cierres (pump_off/valve_close) llevan duración
    float   duration_s;
} buffered_event_t;

static buffered_event_t event_buf[EVENT_BUF_CAP];
static int event_buf_head  = 0;
static int event_buf_count = 0;

static void event_buf_push(const buffered_event_t *e)
{
    int tail = (event_buf_head + event_buf_count) % EVENT_BUF_CAP;
    event_buf[tail] = *e;
    if (event_buf_count < EVENT_BUF_CAP) {
        event_buf_count++;
    } else {
        event_buf_head = (event_buf_head + 1) % EVENT_BUF_CAP;
        ESP_LOGW(TAG, "Buffer de eventos lleno (%d) — descartado el más antiguo", EVENT_BUF_CAP);
    }
}

// Publica en vivo el estado de suministro + los eventos de auditoría de una
// transición, en un solo mensaje. Devuelve false si el publish falló.
static bool publish_events_live(const char *state_str, const buffered_event_t *evs, int nev)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "state", state_str);
    cJSON *events = cJSON_AddArrayToObject(root, "events");
    for (int i = 0; i < nev; i++) {
        cJSON *e = cJSON_CreateObject();
        cJSON_AddStringToObject(e, "type", evs[i].type);
        cJSON_AddStringToObject(e, "trigger", evs[i].override ? "override" : "autonomous");
        if (evs[i].has_duration) {
            cJSON_AddNumberToObject(e, "duration_s", evs[i].duration_s);
        }
        cJSON_AddItemToArray(events, e);
    }
    char *out = cJSON_PrintUnformatted(root);
    bool ok = false;
    if (out) {
        ok = esp_mqtt_client_publish(mqtt_client, topic_events, out, 0, 1, 0) >= 0;
        cJSON_free(out);
    }
    cJSON_Delete(root);
    return ok;
}

// Publica SOLO el estado de suministro en vivo (sin eventos). Se usa al
// reconectar para refrescar la vista en tiempo real del dashboard.
static void publish_state_live(const char *state_str)
{
    if (!mqtt_connected) {
        return;
    }
    char payload[64];
    snprintf(payload, sizeof(payload), "{\"state\":\"%s\"}", state_str);
    esp_mqtt_client_publish(mqtt_client, topic_events, payload, 0, 1, 0);
}

// Vuelca los eventos de auditoría encolados al reconectar, más antiguo primero.
// Cada evento va con age_s; si un publish falla se deja en el buffer y se
// reintenta luego.
static void event_buf_flush(void)
{
    if (event_buf_count == 0) {
        return;
    }
    ESP_LOGI(TAG, "Volcando %d evento(s) de auditoría offline al reconectar", event_buf_count);

    while (event_buf_count > 0 && mqtt_connected) {
        buffered_event_t *e = &event_buf[event_buf_head];
        double age_s = (esp_timer_get_time() - e->capture_us) / 1000000.0;

        cJSON *root = cJSON_CreateObject();
        cJSON *events = cJSON_AddArrayToObject(root, "events");
        cJSON *ev = cJSON_CreateObject();
        cJSON_AddStringToObject(ev, "type", e->type);
        cJSON_AddStringToObject(ev, "trigger", e->override ? "override" : "autonomous");
        if (e->has_duration) {
            cJSON_AddNumberToObject(ev, "duration_s", e->duration_s);
        }
        cJSON_AddNumberToObject(ev, "age_s", age_s);
        cJSON_AddItemToArray(events, ev);

        char *out = cJSON_PrintUnformatted(root);
        int mid = -1;
        if (out) {
            mid = esp_mqtt_client_publish(mqtt_client, topic_events, out, 0, 1, 0);
            cJSON_free(out);
        }
        cJSON_Delete(root);

        if (mid < 0) {
            ESP_LOGW(TAG, "Volcado de eventos pausado (outbox saturado) — %d pendiente(s)", event_buf_count);
            break;
        }
        event_buf_head = (event_buf_head + 1) % EVENT_BUF_CAP;
        event_buf_count--;
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

// Publica el estado del suministro y mueve los actuadores. Solo se llama desde
// irrigation_task. Al SALIR de SUPPLY_PUMP_ON acumula el tiempo de bomba; al
// ENTRAR marca el inicio; al ir a SUPPLY_OFF sella el cooldown.
//
// El payload a totem/<unit_id>/events lleva "state" (estado instantáneo para la
// vista en vivo, no se persiste) y "events" (auditoría de actuador que el server
// SÍ persiste en device_events).
static void set_supply(supply_state_t next)
{
    if (next == supply_state) {
        return;
    }

    supply_state_t prev = supply_state;
    int64_t now_us = esp_timer_get_time();

    int64_t pump_seg_us  = 0;
    int64_t valve_seg_us = 0;

    if (prev == SUPPLY_PUMP_ON && pump_on_since_us != 0) {
        pump_seg_us = now_us - pump_on_since_us;
        pumped_us_accum += pump_seg_us;
        pump_on_since_us = 0;
    }
    if (prev == SUPPLY_SUPPLYING && valve_open_since_us != 0) {
        valve_seg_us = now_us - valve_open_since_us;
        valve_open_since_us = 0;
    }

    supply_state = next;

    switch (next) {
        case SUPPLY_SUPPLYING:
            valve_set(true);
            pump_set(false);
            valve_open_since_us = now_us;
            ESP_LOGI(TAG, "Suministro: ABASTECIENDO — válvula NC abierta (LED en GPIO%d), "
                "esperando flotador", VALVE_LED_GPIO);
            break;
        case SUPPLY_PUMP_ON:
            valve_set(false);
            pump_set(true);
            pump_on_since_us = now_us;
            ESP_LOGI(TAG, "Suministro: BOMBA ENCENDIDA (LED en GPIO%d)", PUMP_LED_GPIO);
            break;
        case SUPPLY_OFF:
        default:
            valve_set(false);
            pump_set(false);
            last_watering_end_us = esp_timer_get_time();
            has_watered_since_boot = true;
            ESP_LOGI(TAG, "Suministro: APAGADO — bomba y válvula cerradas");
            break;
    }

    bool override_flag = (owner == OWNER_MANUAL);

    bool v_prev, p_prev, v_next, p_next;
    supply_levels(prev, &v_prev, &p_prev);
    supply_levels(next, &v_next, &p_next);

    buffered_event_t evs[2];
    int nev = 0;
    if (p_prev != p_next) {
        buffered_event_t *e = &evs[nev++];
        e->capture_us   = now_us;
        strcpy(e->type, p_next ? "pump_on" : "pump_off");
        e->override     = override_flag;
        e->has_duration = !p_next;                       // solo el cierre lleva duración
        e->duration_s   = pump_seg_us / 1000000.0f;
    }
    if (v_prev != v_next) {
        buffered_event_t *e = &evs[nev++];
        e->capture_us   = now_us;
        strcpy(e->type, v_next ? "valve_open" : "valve_close");
        e->override     = override_flag;
        e->has_duration = !v_next;
        e->duration_s   = valve_seg_us / 1000000.0f;
    }

    if (nev == 0) {
        return;   // transición sin cambio de actuadores (defensa; no debería ocurrir)
    }

    if (mqtt_connected) {
        if (!publish_events_live(supply_state_str(next), evs, nev)) {
            for (int i = 0; i < nev; i++) {
                event_buf_push(&evs[i]);
            }
        }
    } else {
        for (int i = 0; i < nev; i++) {
            event_buf_push(&evs[i]);
        }
    }
}

// Tiempo total de bomba encendida en el ciclo actual (acumulado + tramo en curso).
static int64_t total_pumped_us(void)
{
    int64_t t = pumped_us_accum;
    if (pump_on_since_us != 0) {
        t += esp_timer_get_time() - pump_on_since_us;
    }
    return t;
}

// Mueve el suministro según el flotador: si hay solución suficiente bombea, si
// no abre la válvula NC y espera.
static void drive_supply(void)
{
    if (float_switch_up()) {
        set_supply(SUPPLY_PUMP_ON);
    } else {
        set_supply(SUPPLY_SUPPLYING);
    }
}

// Detiene cualquier riego en curso: apaga suministro (sella cooldown) y suelta
// el control.
static void stop_watering(void)
{
    set_supply(SUPPLY_OFF);
    owner = OWNER_NONE;
}

// ============================================================
// Sensores de gas — lectura cruda del ADC
// ============================================================

static void gas_sensors_init(void)
{
    adc_oneshot_unit_init_cfg_t init_cfg = {
        .unit_id = ADC_UNIT_1,
    };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&init_cfg, &adc1_handle));

    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten    = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1_handle, METHANE_ADC_CHANNEL, &chan_cfg));
    ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1_handle, AIR_QUALITY_ADC_CHANNEL, &chan_cfg));
}

// Conteo crudo del ADC (0-4095 @ 12 bits) de cada gas, sin calibrar — no
// representa ppm ni ninguna unidad real, es solo para monitoreo/verificación.
static int methane_read(void)
{
    int raw = 0;
    ESP_ERROR_CHECK(adc_oneshot_read(adc1_handle, METHANE_ADC_CHANNEL, &raw));
    return raw;
}

static int air_quality_read(void)
{
    int raw = 0;
    ESP_ERROR_CHECK(adc_oneshot_read(adc1_handle, AIR_QUALITY_ADC_CHANNEL, &raw));
    return raw;
}

// ============================================================
// Sensor de CO2 — Senseair S8 (UART/Modbus)
// ============================================================

static void s8_co2_init(void)
{
    uart_config_t uart_cfg = {
        .baud_rate  = S8_UART_BAUD,
        .data_bits  = UART_DATA_8_BITS,
        .parity     = UART_PARITY_DISABLE,
        .stop_bits  = UART_STOP_BITS_1,
        .flow_ctrl  = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    // RX buffer > 128 (FIFO) por requisito del driver; sin TX buffer (bloqueante).
    ESP_ERROR_CHECK(uart_driver_install(S8_UART_PORT, 256, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(S8_UART_PORT, &uart_cfg));
    ESP_ERROR_CHECK(uart_set_pin(S8_UART_PORT, S8_TX_GPIO, S8_RX_GPIO,
                                 UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
}

// CRC16-Modbus (polinomio 0xA001, init 0xFFFF), byte bajo primero en la trama.
static uint16_t modbus_crc16(const uint8_t *data, int len)
{
    uint16_t crc = 0xFFFF;
    for (int i = 0; i < len; i++) {
        crc ^= data[i];
        for (int b = 0; b < 8; b++) {
            crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : (crc >> 1);
        }
    }
    return crc;
}

// Lee el CO2 en ppm del S8: pide IR4 (función 0x04, dirección 0x0003) y parsea la
// respuesta. Devuelve ppm (>= 0) o -1 si no hubo respuesta / respuesta inválida
// (cableado R/T invertido, sensor calentando, ruido en la línea). El llamador
// decide si publica: durante la fase de prueba, -1 es señal para invertir R/T.
static int s8_co2_read(void)
{
    // Trama constante: FE 04 00 03 00 01 D5 C5 (CRC ya precalculado, low-first).
    static const uint8_t req[8] = {0xFE, 0x04, 0x00, 0x03, 0x00, 0x01, 0xD5, 0xC5};
    uint8_t resp[7] = {0};

    uart_flush_input(S8_UART_PORT);
    if (uart_write_bytes(S8_UART_PORT, req, sizeof(req)) != sizeof(req)) {
        ESP_LOGW(TAG, "S8: fallo al escribir la petición en UART");
        return -1;
    }

    int n = uart_read_bytes(S8_UART_PORT, resp, sizeof(resp), pdMS_TO_TICKS(200));
    if (n != (int)sizeof(resp)) {
        ESP_LOGW(TAG, "S8: sin respuesta o incompleta (%d de %d bytes)", n, (int)sizeof(resp));
        return -1;
    }

    // Cabecera esperada: dirección FE, función 04, 2 bytes de datos.
    if (resp[0] != 0xFE || resp[1] != 0x04 || resp[2] != 0x02) {
        ESP_LOGW(TAG, "S8: cabecera inesperada %02X %02X %02X", resp[0], resp[1], resp[2]);
        return -1;
    }

    uint16_t crc_calc = modbus_crc16(resp, 5);
    uint16_t crc_recv = (uint16_t)resp[5] | ((uint16_t)resp[6] << 8);  // CRC low-first
    if (crc_calc != crc_recv) {
        ESP_LOGW(TAG, "S8: CRC inválido (calc=%04X recv=%04X)", crc_calc, crc_recv);
        return -1;
    }

    return ((int)resp[3] << 8) | resp[4];  // CO2 ppm, big-endian
}

// ============================================================
// Perfil de Cultivo Activo — caché en flash (NVS) + parseo
// ============================================================
// Ver docs/transversal/crop-profile.md: la decisión de riego debe seguir
// funcionando con el último perfil conocido aunque la unidad esté offline.

static void profile_save_raw(const char *data, int data_len)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(PROFILE_NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Perfil: no se pudo abrir NVS para cachear (%s)", esp_err_to_name(err));
        return;
    }

    char buf[PROFILE_JSON_MAX_LEN];
    int len = data_len < (int)sizeof(buf) - 1 ? data_len : (int)sizeof(buf) - 1;
    memcpy(buf, data, len);
    buf[len] = '\0';

    err = nvs_set_str(handle, PROFILE_NVS_KEY, buf);
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Perfil: no se pudo escribir en NVS (%s)", esp_err_to_name(err));
    }
    nvs_close(handle);
}

static bool profile_load_raw(char *buf, size_t buf_size)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(PROFILE_NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) {
        return false;  // namespace no existe todavía — unidad nunca recibió un perfil
    }

    size_t len = buf_size;
    err = nvs_get_str(handle, PROFILE_NVS_KEY, buf, &len);
    nvs_close(handle);
    return err == ESP_OK;
}

// Parsea el perfil (mismo payload que publica routers/units.py assign_profile)
// hacia *out. Solo extrae lo que fixed_timer necesita. *out se deja en cero
// salvo los campos presentes (para que memcmp entre perfiles sea estable).
static bool profile_parse(const char *data, int data_len, crop_profile_t *out)
{
    cJSON *json = cJSON_ParseWithLength(data, data_len);
    if (!json) {
        ESP_LOGE(TAG, "Perfil: JSON inválido");
        return false;
    }

    crop_profile_t next;
    memset(&next, 0, sizeof(next));
    next.loaded = true;

    cJSON *method = cJSON_GetObjectItem(json, "irrigation_method");
    if (cJSON_IsString(method)) {
        strncpy(next.irrigation_method, method->valuestring, sizeof(next.irrigation_method) - 1);
    }

    cJSON *params = cJSON_GetObjectItem(json, "irrigation_params");
    if (cJSON_IsObject(params)) {
        cJSON *v;
        if ((v = cJSON_GetObjectItem(params, "cycle_duration_s")) && cJSON_IsNumber(v)) {
            next.cycle_duration_s = (float)v->valuedouble;
        }
        if ((v = cJSON_GetObjectItem(params, "min_interval_s")) && cJSON_IsNumber(v)) {
            next.min_interval_s = (float)v->valuedouble;
        }
    }

    cJSON_Delete(json);

    if (next.irrigation_method[0] == '\0') {
        ESP_LOGW(TAG, "Perfil: sin irrigation_method, se ignora");
        return false;
    }

    // Este firmware solo sabe regar con timer fijo. Un perfil con otro método
    // (p.ej. vpd_threshold) se cachea/aplica igual, pero run_decision no regará
    // con él y lo logueará como método no soportado. El server, al publicar el
    // release, marca solo `fixed_timer` en supported_irrigation_methods, así que
    // en la práctica no debería asignarse otro método a esta unidad.
    if (strcmp(next.irrigation_method, "fixed_timer") != 0) {
        ESP_LOGW(TAG, "Perfil: método '%s' no soportado por monitorio (solo fixed_timer)",
            next.irrigation_method);
    }

    *out = next;
    return true;
}

static void profile_log(const crop_profile_t *p)
{
    ESP_LOGI(TAG, "Perfil activo: método=%s duracion_ciclo=%.0fs intervalo_min=%.0fs",
        p->irrigation_method, p->cycle_duration_s, p->min_interval_s);
}

// ============================================================
// Comandos — solo publican eventos hacia irrigation_task
// ============================================================

static void handle_command(const char *data, int data_len)
{
    cJSON *json = cJSON_ParseWithLength(data, data_len);
    if (!json) {
        ESP_LOGE(TAG, "Comando: JSON inválido");
        return;
    }

    cJSON *type = cJSON_GetObjectItem(json, "type");
    if (cJSON_IsString(type)) {
        if (strcmp(type->valuestring, "pump_on") == 0) {
            irrig_ev_t ev = { .type = IRRIG_EV_MANUAL_ON };
            xQueueSend(irrig_queue, &ev, 0);
            ESP_LOGI(TAG, "Comando manual: pump_on");
        } else if (strcmp(type->valuestring, "pump_off") == 0) {
            irrig_ev_t ev = { .type = IRRIG_EV_MANUAL_OFF };
            xQueueSend(irrig_queue, &ev, 0);
            ESP_LOGI(TAG, "Comando manual: pump_off");
        } else {
            ESP_LOGW(TAG, "Comando desconocido: %s", type->valuestring);
        }
    }

    cJSON_Delete(json);
}

// ============================================================
// MQTT
// ============================================================

static void mqtt_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t) data;

    switch (id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI(TAG, "MQTT conectado");
            mqtt_connected = true;
            esp_mqtt_client_subscribe(mqtt_client, topic_commands, 1);
            esp_mqtt_client_subscribe(mqtt_client, topic_ota,      1);
            esp_mqtt_client_subscribe(mqtt_client, topic_profile,  1);
            ESP_LOGI(TAG, "Suscrito a: %s, %s, %s", topic_commands, topic_ota, topic_profile);

            totem_publish_status(mqtt_client, topic_status);
            totem_rollback_confirm();
            break;

        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGW(TAG, "MQTT desconectado");
            mqtt_connected = false;
            break;

        case MQTT_EVENT_DATA: {
            char topic[128] = {0};
            int topic_len = event->topic_len < (int)sizeof(topic) - 1
                            ? event->topic_len : (int)sizeof(topic) - 1;
            strncpy(topic, event->topic, topic_len);

            if (strcmp(topic, topic_commands) == 0) {
                ESP_LOGI(TAG, "Comando recibido: %.*s", event->data_len, event->data);
                handle_command(event->data, event->data_len);
            } else if (strcmp(topic, topic_ota) == 0) {
                ESP_LOGI(TAG, "Mensaje OTA recibido");
                totem_ota_handle_message(event->data, event->data_len);
            } else if (strcmp(topic, topic_profile) == 0) {
                ESP_LOGI(TAG, "Perfil recibido: %.*s", event->data_len, event->data);
                irrig_ev_t ev = { .type = IRRIG_EV_PROFILE };
                if (profile_parse(event->data, event->data_len, &ev.profile)) {
                    profile_save_raw(event->data, event->data_len);
                    xQueueSend(irrig_queue, &ev, 0);
                    totem_status_led_pulse(5000);
                }
            } else {
                ESP_LOGI(TAG, "Mensaje en [%s]: %.*s", topic, event->data_len, event->data);
            }
            break;
        }

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
        .broker.address.uri                  = config.mqtt_uri,
        .credentials.username                = config.unit_id,
        .credentials.authentication.password  = config.api_key,
        .credentials.client_id                = config.unit_id,
    };

    mqtt_client = esp_mqtt_client_init(&cfg);
    esp_mqtt_client_register_event(mqtt_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    esp_mqtt_client_start(mqtt_client);
}

// ============================================================
// Publicación de lecturas — gases (metano + calidad de aire)
// ============================================================
// Publica el metano y la calidad de aire crudos a `readings` cada 10 s. Como
// efecto secundario mantiene viva la señal en el dashboard: el server refresca
// last_seen solo con mensajes a `readings` o `events`, y el frontend marca "sin
// señal" si last_seen tiene más de 35 s (OFFLINE_MS). Los gases son SOLO
// monitoreo — no alimentan la decisión de riego (fixed_timer no usa sensores).
static void publish_readings_task(void *pvParameters)
{
    char payload[96];
    while (1) {
        if (!totem_ota_in_progress() && mqtt_connected) {
            int methane = methane_read();
            int air_quality = air_quality_read();
            int co2 = s8_co2_read();  // ppm calibrado, o -1 si el S8 no respondió

            // Solo se incluye "co2" cuando la lectura es válida — si el S8 no
            // responde (p.ej. R/T invertidos o calentando) se publica el resto
            // igual y se loguea, sin ensuciar el contrato con un valor falso.
            char co2str[16];
            if (co2 >= 0) {
                snprintf(payload, sizeof(payload),
                    "{\"methane\":%d,\"air_quality\":%d,\"co2\":%d}",
                    methane, air_quality, co2);
                snprintf(co2str, sizeof(co2str), "%dppm", co2);
            } else {
                snprintf(payload, sizeof(payload),
                    "{\"methane\":%d,\"air_quality\":%d}", methane, air_quality);
                strcpy(co2str, "sin_resp");
            }
            esp_mqtt_client_publish(mqtt_client, topic_readings, payload, 0, 1, 0);
            ESP_LOGI(TAG, "metano=%d aire=%d co2=%s | bomba=%s valvula=%s | mqtt=ok",
                methane, air_quality, co2str,
                pump_on ? "ON" : "OFF", valve_open ? "ABIERTA" : "cerrada");
        }
        vTaskDelay(pdMS_TO_TICKS(READINGS_INTERVAL_MS));
    }
}

// ============================================================
// Ciclo de decisión automático — solo timer fijo
// ============================================================

// Programa el deadline de la próxima decisión desde AHORA.
// fixed_timer: min_interval_s es el periodo completo inicio-a-inicio; como el
// riego ocupa cycle_duration_s de ese periodo, lo que se espera antes del
// siguiente es el resto (min_interval − cycle). Como esta función se llama al
// TERMINAR el riego, el periodo real inicio-a-inicio da ~min_interval_s.
// Sin perfil (o método no soportado): housekeeping fijo de 60 s.
static void schedule_next_decision(void)
{
    int64_t interval_ms;
    if (profile.loaded && strcmp(profile.irrigation_method, "fixed_timer") == 0) {
        float gap_s = profile.min_interval_s - profile.cycle_duration_s;
        if (gap_s < 0.0f) {
            gap_s = 0.0f;
        }
        interval_ms = (int64_t)(gap_s * 1000.0f);
    } else {
        interval_ms = HOUSEKEEPING_INTERVAL_MS;
    }
    next_decision_us = esp_timer_get_time() + interval_ms * 1000;
}

// Evalúa si toca regar y, si sí, arranca un riego automático (owner=AUTO).
// Devuelve true si arrancó el riego (el reschedule ocurre al terminarlo, en
// on_water_tick). Devuelve false si no regó (el llamador reprograma).
static bool run_decision(void)
{
    if (!profile.loaded) {
        ESP_LOGI(TAG, "Decisión automática: sin perfil activo, no se riega");
        return false;
    }

    if (strcmp(profile.irrigation_method, "fixed_timer") != 0) {
        ESP_LOGW(TAG, "Decisión automática: método '%s' no soportado (solo fixed_timer)",
            profile.irrigation_method);
        return false;
    }

    float duration_s = profile.cycle_duration_s;
    if (duration_s <= 0.0f) {
        ESP_LOGW(TAG, "Decisión automática: cycle_duration_s inválido (%.1f), no se riega", duration_s);
        return false;
    }

    // Arranca el riego automático. La duración se mide como tiempo REAL de bomba
    // encendida (ver on_water_tick), no como reloj de pared.
    owner = OWNER_AUTO;
    target_pump_on_s = duration_s;
    pumped_us_accum  = 0;
    pump_on_since_us = 0;
    ESP_LOGI(TAG, "Riego automático (timer fijo) iniciado — duración de bombeo objetivo: %.0fs", duration_s);
    drive_supply();
    return true;
}

static void run_decision_and_schedule(void)
{
    if (!run_decision()) {
        schedule_next_decision();
    }
}

// Sondeo del suministro mientras se riega (cada SUPPLY_POLL_MS): mientras se
// LLENA (SUPPLY_SUPPLYING) re-chequea el flotador para arrancar a bombear. Una
// vez que la bomba está encendida deja de mirar el flotador (es normal que el
// nivel baje al bombear). Para riego automático, corta cuando el tiempo REAL
// bombeado alcanza el objetivo.
static void on_water_tick(void)
{
    if (supply_state != SUPPLY_PUMP_ON) {
        drive_supply();
    }

    if (owner == OWNER_AUTO &&
        total_pumped_us() >= (int64_t)(target_pump_on_s * 1000000.0f)) {
        ESP_LOGI(TAG, "Riego automático completado (%.0fs de bombeo real)", target_pump_on_s);
        stop_watering();
        schedule_next_decision();
    }
}

// Aplica un evento recibido por la cola. Único punto donde el perfil y el
// control (owner) se mutan por comandos externos — un solo hilo.
static void handle_event(const irrig_ev_t *ev)
{
    switch (ev->type) {
        case IRRIG_EV_PROFILE: {
            // Solo re-evaluar de inmediato si el perfil realmente cambió — así la
            // re-entrega del perfil retenido en cada reconexión MQTT no dispara un
            // riego espurio. Y solo si nadie está regando.
            bool changed = !profile.loaded ||
                           memcmp(&profile, &ev->profile, sizeof(profile)) != 0;
            profile = ev->profile;
            profile_log(&profile);
            if (changed && owner == OWNER_NONE) {
                run_decision_and_schedule();
            }
            break;
        }

        case IRRIG_EV_MANUAL_ON:
            // Manual siempre toma el control, incluso interrumpiendo un riego
            // automático en curso. Riega hasta que llegue pump_off.
            owner = OWNER_MANUAL;
            ESP_LOGI(TAG, "Riego manual — verificando flotador antes de bombear");
            drive_supply();
            break;

        case IRRIG_EV_MANUAL_OFF:
            if (owner != OWNER_NONE) {
                ESP_LOGI(TAG, "Riego detenido por comando manual");
                stop_watering();
                schedule_next_decision();
            }
            break;
    }
}

// Tarea única dueña del riego. Su espera en la cola cumple doble función:
// recibir eventos (comandos, perfil) Y servir de temporizador de la
// decisión/sondeo. El deadline es absoluto (next_decision_us).
static void irrigation_task(void *pvParameters)
{
    crop_profile_t *boot = (crop_profile_t *)pvParameters;
    if (boot) {
        profile = *boot;
        profile_log(&profile);
    }

    // Primera decisión a los 15 s del arranque (margen para el perfil retenido).
    next_decision_us = esp_timer_get_time() + (int64_t)FIRST_DECISION_DELAY_MS * 1000;

    bool was_connected = false;

    while (1) {
        // Al RECUPERAR la conexión MQTT: refresca el estado de suministro en vivo
        // y vuelca los eventos de auditoría encolados (solo si no se está regando,
        // para no retrasar el corte de la bomba con el batch de publicaciones).
        bool now_connected = mqtt_connected;
        if (now_connected && !was_connected) {
            publish_state_live(supply_state_str(supply_state));
        }
        was_connected = now_connected;
        if (now_connected && owner == OWNER_NONE) {
            event_buf_flush();
        }

        uint32_t wait_ms;
        if (owner != OWNER_NONE) {
            wait_ms = SUPPLY_POLL_MS;
        } else {
            int64_t rem_us = next_decision_us - esp_timer_get_time();
            wait_ms = rem_us > 0 ? (uint32_t)(rem_us / 1000) : 0;
        }

        irrig_ev_t ev;
        if (xQueueReceive(irrig_queue, &ev, pdMS_TO_TICKS(wait_ms)) == pdTRUE) {
            handle_event(&ev);
            continue;
        }

        // Timeout — toca "tick": sondeo de suministro si regamos, o decisión.
        if (owner != OWNER_NONE) {
            on_water_tick();
        } else if (totem_ota_in_progress()) {
            next_decision_us = esp_timer_get_time() + (int64_t)HOUSEKEEPING_INTERVAL_MS * 1000;
        } else {
            run_decision_and_schedule();
        }
    }
}

// ============================================================
// Entry point
// ============================================================

void app_main(void)
{
    totem_rollback_init();

    ESP_ERROR_CHECK(nvs_flash_init());
    totem_config_load(&config);

    snprintf(topic_readings, sizeof(topic_readings), "totem/%s/readings", config.unit_id);
    snprintf(topic_commands, sizeof(topic_commands), "totem/%s/commands", config.unit_id);
    snprintf(topic_events,   sizeof(topic_events),   "totem/%s/events",   config.unit_id);
    snprintf(topic_ota,      sizeof(topic_ota),      "totem/%s/ota",      config.unit_id);
    snprintf(topic_profile,  sizeof(topic_profile),  "totem/%s/profile",  config.unit_id);
    snprintf(topic_status,   sizeof(topic_status),   "totem/%s/status",   config.unit_id);

    actuators_init();
    gas_sensors_init();
    s8_co2_init();
    totem_status_led_init();

    // Cola de eventos hacia irrigation_task — creada antes de arrancar WiFi/MQTT
    // para que el handler pueda publicar en cuanto llegue el primer mensaje.
    irrig_queue = xQueueCreate(8, sizeof(irrig_ev_t));

    // Perfil cacheado en NVS de un arranque anterior — se carga antes de conectar
    // WiFi para poder decidir riego aunque la unidad arranque offline.
    char cached_profile[PROFILE_JSON_MAX_LEN];
    if (profile_load_raw(cached_profile, sizeof(cached_profile))) {
        if (profile_parse(cached_profile, (int)strlen(cached_profile), &boot_profile)) {
            boot_profile_valid = true;
            ESP_LOGI(TAG, "Perfil cacheado en NVS cargado correctamente");
        }
    } else {
        ESP_LOGI(TAG, "Sin perfil cacheado en NVS — esperando el primero por MQTT");
    }

    totem_wifi_connect(&config);
    mqtt_init();

    vTaskDelay(pdMS_TO_TICKS(2000));

    xTaskCreate(publish_readings_task, "readings", 4096, NULL, 5, NULL);
    xTaskCreate(irrigation_task, "irrigation", 4096,
                boot_profile_valid ? &boot_profile : NULL, 5, NULL);
}
