// Primer firmware Totem con sensor real y actuador físico.
//
// A diferencia de firmware/simulator (que genera lecturas sintéticas), este
// firmware lee temperatura y humedad reales de un sensor RQ-S003 (módulo
// REXQualis basado en DHT11, protocolo de un solo hilo, driver en
// firmware/components/totem_dht11) y refleja el estado de la bomba en un LED
// físico en vez de solo loguearlo.
//
// WiFi/NVS/OTA/rollback vienen de firmware/components/totem_core — ver
// firmware/NON-NEGOTIABLES.md para el contrato completo que cualquier
// firmware nuevo debe respetar.
//
// ============================================================
// Coordinación de riego — una sola tarea dueña, manejada por eventos
// ============================================================
// La decisión de riego (cuándo y cuánto) y la actuación física (flotador,
// válvula, bomba) NO viven en dos tareas separadas coordinadas por flags
// `volatile` polleados. Eso generaba carreras de timing: el cronómetro de
// riego corría contra reloj de pared aunque la bomba nunca se encendiera
// (tanque llenándose), el sellado del cooldown lo hacía otra tarea con lag,
// el perfil se leía a medio actualizar (torn read), y una notificación
// latcheada podía disparar riegos dobles.
//
// En su lugar hay UNA tarea (irrigation_task) dueña de: perfil activo,
// última lectura T/RH, máquina de estados del suministro, bomba/válvula,
// cooldown y decisión. Todo lo demás (handler MQTT, tarea de lecturas) solo
// PUBLICA eventos en irrig_queue; nunca toca actuadores ni estado de riego.
// Al ser un único hilo el que muta ese estado, no hay carreras posibles.
#include <math.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "mqtt_client.h"
#include "cJSON.h"
#include "totem_core.h"
#include "totem_dht11.h"

// ============================================================
// Sensor (RQ-S003 / DHT11) y actuador (LED que simula la bomba)
// ============================================================
//
// Mapeo físico confirmado sobre el board ESP32-C6 SuperMini en uso (headers
// izquierdo/derecho leídos directamente del silkscreen):
//   - Izquierda: 5V, GND, 3V3, GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5
//   - Derecha:   TX, RX, GPIO14, GPIO15, GPIO18, GPIO19, GPIO20, GPIO21, GPIO22
//   - GPIO8 (LED RGB WS2812) y GPIO9 (botón BOOT, strapping) van integrados
//     en la placa — no están expuestos en estos headers y no deben usarse
//     para periféricos externos.
//
// DATA se movió de GPIO4 a GPIO18: GPIO4 es un pin de strapping (parte de la
// interfaz JTAG junto con GPIO5-7 en el ESP32-C6) — al descartar cableado,
// timing y sensor como causa de los timeouts persistentes, se prueba un pin
// sin ninguna función especial en el arranque para eliminar esa variable.
#define DHT_GPIO        GPIO_NUM_4   // DATA del RQ-S003 (pull-up ya incluido en el módulo)
#define PUMP_LED_GPIO   GPIO_NUM_5   // LED que simula el encendido/apagado de la bomba

// Fotoresistor (LDR) del kit RexQualis, como divisor de voltaje:
// 3V3 -> LDR -> (nodo ADC) -> resistencia fija (10kΩ) -> GND.
// Más luz => menor resistencia del LDR => mayor voltaje en el nodo ADC.
// GPIO1 = ADC1_CHANNEL_1 en el ESP32-C6, libre en el header izquierdo y sin
// función de strapping (a diferencia de GPIO4/5/8/9/15).
#define LDR_ADC_CHANNEL ADC_CHANNEL_1

// Simulación del módulo de suministro (ver
// docs/capa1/totem-principal/sistema-riego/modulo-suministro.md): antes de
// regar hay que verificar que el flotador esté arriba (solución suficiente).
// Si no, se abre la válvula NC hasta que el flotador suba.
//   - VALVE_LED_GPIO: LED que simula la válvula NC (encendido = abierta).
//   - FLOAT_SWITCH_GPIO: flotador real (interruptor mecánico), con pull-up
//     interno. A diferencia de un botón normal, este flotador **cierra el
//     circuito (deja pasar corriente) cuando está ABAJO** y lo **abre
//     (corta la corriente) cuando está ARRIBA** — es decir, LOW = flotador
//     abajo (solución insuficiente), HIGH = flotador arriba (suficiente).
#define VALVE_LED_GPIO      GPIO_NUM_2
#define FLOAT_SWITCH_GPIO   GPIO_NUM_3

// Umbral de alerta — mismo criterio que firmware/simulator, ahora evaluado
// sobre temperatura real en vez de un modelo simulado.
#define TEMP_ALERT      40.0f   // umbral que dispara alerta
#define TEMP_SAFE       38.0f   // por debajo de aquí se resetea la alerta

// Cadencia de "housekeeping" del ciclo de decisión — aplica cuando no hay
// perfil activo, y a vpd_threshold (necesita muestrear VPD con cierta
// frecuencia, independiente de min_interval_s que ahí es solo un enfriamiento
// post-riego). fixed_timer NO usa esto — su periodo se deriva de
// min_interval_s (ver schedule_next_decision). Decisión — 11 jul 2026: se
// cierra el pendiente de docs/ecosistema/overview.md en 60s; el argumento de
// ahorro de energía para un intervalo más largo no sostenía por sí solo
// 3 min, dado que el radio WiFi/MQTT ya despierta cada 10s para publicar
// lecturas.
#define HOUSEKEEPING_INTERVAL_MS (60 * 1000)

// Primera evaluación de riego tras el arranque — solo el margen para que
// publish_readings_task ya haya hecho al menos una lectura de T/RH, no hay
// que esperar la cadencia completa.
#define FIRST_DECISION_DELAY_MS  (15 * 1000)

// Cadencia de sondeo del suministro mientras se está regando (llenando o
// bombeando): cada cuánto se re-chequea el flotador y se acumula el tiempo
// real de bomba encendida.
#define SUPPLY_POLL_MS           200

// Namespace/clave NVS donde se cachea el último perfil recibido (crudo, tal
// cual llega por MQTT) — ver docs/transversal/crop-profile.md: el ESP32
// siempre debe poder decidir con el último perfil conocido, incluso offline.
#define PROFILE_NVS_NAMESPACE "profile"
#define PROFILE_NVS_KEY       "json"
#define PROFILE_JSON_MAX_LEN  512

static const char *TAG = "genesis";
static esp_mqtt_client_handle_t mqtt_client = NULL;

// Espejos de estado solo para logging desde publish_readings_task — los
// escribe pump_set/valve_set (dentro de irrigation_task) y los lee la tarea
// de lecturas. Carrera benigna: es un log, no una decisión.
static volatile bool pump_on = false;
static volatile bool valve_open = false;

static totem_config_t config;
static adc_oneshot_unit_handle_t adc1_handle;

// ============================================================
// Perfil de cultivo activo (struct) — POD, se copia por valor
// ============================================================

typedef struct {
    bool  loaded;
    char  irrigation_method[32];
    bool  has_light_range;
    float light_min;
    float light_max;
    float threshold_vpd_kpa;  // vpd_threshold
    float base_duration_s;    // vpd_threshold
    float cycle_duration_s;   // fixed_timer
    float min_interval_s;     // ambos métodos
} crop_profile_t;

// ============================================================
// Eventos hacia irrigation_task
// ============================================================
// Único canal por el que el handler MQTT y la tarea de lecturas se comunican
// con la tarea de riego. Todo lo que antes eran flags `volatile` compartidos
// (watering_requested, current_trigger, last_temperature/humidity,
// active_profile) ahora viaja como evento y lo aplica un solo hilo.

typedef enum {
    IRRIG_EV_READING,     // nueva lectura T/RH válida
    IRRIG_EV_PROFILE,     // perfil nuevo recibido/parseado
    IRRIG_EV_MANUAL_ON,   // comando manual pump_on
    IRRIG_EV_MANUAL_OFF,  // comando manual pump_off
} irrig_ev_type_t;

typedef struct {
    irrig_ev_type_t type;
    union {
        struct { float temperature; float humidity; } reading;
        crop_profile_t profile;
    } data;
} irrig_ev_t;

static QueueHandle_t irrig_queue = NULL;

// Perfil cargado desde NVS en app_main y entregado a irrigation_task como
// pvParameters (no por la cola — se aplica una sola vez, en el init de la
// tarea, antes de que exista concurrencia). Ha de ser estático: su dirección
// sobrevive a que app_main retorne (la tarea creada sigue viva).
static crop_profile_t boot_profile;
static bool           boot_profile_valid = false;

// Topics MQTT — construidos después de cargar unit_id desde NVS
static char topic_readings[96];
static char topic_commands[96];
static char topic_alerts[96];
static char topic_events[96];
static char topic_ota[96];
static char topic_profile[96];
static char topic_status[96];

static void pump_led_init(void)
{
    gpio_config_t led_cfg = {
        .pin_bit_mask = 1ULL << PUMP_LED_GPIO,
        .mode         = GPIO_MODE_OUTPUT,
    };
    gpio_config(&led_cfg);
    gpio_set_level(PUMP_LED_GPIO, 0);
}

// ============================================================
// Módulo de suministro (simulado) — flotador (botón) y válvula NC (LED)
// ============================================================

static void supply_module_init(void)
{
    gpio_config_t valve_cfg = {
        .pin_bit_mask = 1ULL << VALVE_LED_GPIO,
        .mode         = GPIO_MODE_OUTPUT,
    };
    gpio_config(&valve_cfg);
    gpio_set_level(VALVE_LED_GPIO, 0);

    gpio_config_t float_cfg = {
        .pin_bit_mask = 1ULL << FLOAT_SWITCH_GPIO,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
    };
    gpio_config(&float_cfg);
}

// true = flotador arriba (solución suficiente). El flotador corta el
// circuito al subir, así que con el pull-up interno arriba = HIGH.
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
// Estas variables solo se leen/escriben desde el contexto de irrigation_task
// (handle_event, on_water_tick, run_decision, set_supply, drive_supply,
// stop_watering, schedule_next_decision). Por eso NO son volatile ni llevan
// sincronización: un único hilo las toca.

// Estado público del módulo de suministro, reportado al server vía
// totem/<unit_id>/events para que el dashboard distinga "regando" de
// "esperando a que se llene el tanque" en vez de ver solo silencio tras el
// comando pump_on (ver modulo-suministro.md).
typedef enum {
    SUPPLY_OFF,        // bomba y válvula apagadas
    SUPPLY_SUPPLYING,  // válvula NC abierta, esperando a que el flotador suba
    SUPPLY_PUMP_ON,    // solución suficiente, bomba regando
} supply_state_t;

static supply_state_t supply_state = SUPPLY_OFF;

// Quién controla el riego ahora mismo. Reemplaza al viejo water_trigger_t
// compartido: al vivir en un solo hilo, las transiciones son atómicas por
// construcción (no hay carreras de dos instrucciones como antes).
typedef enum {
    OWNER_NONE,     // nadie riega
    OWNER_MANUAL,   // un comando manual tiene el control (riega hasta pump_off)
    OWNER_AUTO,     // el ciclo automático tiene el control (riega hasta cumplir duración)
} irrig_owner_t;

static irrig_owner_t owner = OWNER_NONE;

// Perfil activo y última lectura — copias locales de la tarea (nadie más las
// lee; el torn read del viejo `active_profile` global desaparece).
static crop_profile_t profile = { .loaded = false };
static float last_temp = NAN;
static float last_hum  = NAN;
static bool  have_reading = false;

// --- Contabilización de tiempo REAL de bomba encendida (arregla el bug del
// cronómetro que corría contra reloj de pared aunque el tanque estuviera
// llenándose) ---
// Un ciclo automático termina cuando el tiempo acumulado con la bomba
// efectivamente encendida alcanza target_pump_on_s, no cuando pasó ese
// tiempo de reloj. Si el flotador baja a mitad de riego, la bomba se apaga,
// se abre la válvula, y el acumulador se pausa hasta que vuelva a bombear.
static float   target_pump_on_s = 0.0f;   // objetivo del ciclo automático
static int64_t pumped_us_accum  = 0;      // us bombeados acumulados en el ciclo actual
static int64_t pump_on_since_us = 0;      // instante de encendido (0 = bomba apagada)

// Cooldown: instante real del fin del último riego (sellado en la transición
// a SUPPLY_OFF, dentro de esta misma tarea, sin lag de poller). El ciclo
// automático vpd_threshold no vuelve a regar antes de min_interval_s desde
// aquí. Un riego manual también lo sella — así reinicia la espera del
// siguiente automático.
static int64_t last_watering_end_us = 0;

// false hasta el primer riego real. Sin esto, min_interval_s se compararía
// contra el uptime desde el arranque (last_watering_end_us=0), y un
// min_interval_s mayor al tiempo encendido bloquearía el primer ciclo
// automático aunque nunca se hubiera regado. "Nunca regué" debe permitir
// regar de inmediato.
static bool has_watered_since_boot = false;

// Deadline ABSOLUTO de la próxima decisión automática. Se usa deadline
// absoluto (no un timeout relativo) para que los eventos frecuentes
// (EV_READING cada 10s) que despiertan la cola no empujen ni adelanten la
// decisión: la cadencia se mide contra este instante fijo, no contra cada
// vez que la tarea se despierta.
static int64_t next_decision_us = 0;

// Nivel físico de cada actuador para un estado de suministro dado. Se usa
// para derivar, por diferencia entre el estado anterior y el nuevo, qué
// eventos de auditoría de actuador (pump_on/off, valve_open/close) generó la
// transición — ver set_supply.
static void supply_levels(supply_state_t s, bool *valve, bool *pump)
{
    *valve = (s == SUPPLY_SUPPLYING);   // válvula NC abierta solo mientras se llena
    *pump  = (s == SUPPLY_PUMP_ON);     // bomba encendida solo al bombear
}

// Estado del suministro tal como lo consume la vista en vivo del dashboard
// (WebSocket). NO es un evento de auditoría — es el estado instantáneo.
static const char *supply_state_str(supply_state_t s)
{
    switch (s) {
        case SUPPLY_SUPPLYING: return "supplying";
        case SUPPLY_PUMP_ON:   return "pump_on";
        case SUPPLY_OFF:
        default:               return "off";
    }
}

// Publica el estado del suministro y mueve los actuadores. Solo se llama
// desde irrigation_task. Al SALIR de SUPPLY_PUMP_ON acumula el tiempo que la
// bomba estuvo encendida; al ENTRAR a SUPPLY_PUMP_ON marca el inicio; al ir a
// SUPPLY_OFF sella el cooldown (fin real del riego).
//
// El payload a totem/<unit_id>/events lleva DOS cosas con consumidores
// distintos (ver docs/capa2/schema.md tabla device_events y server/state.py):
//   - "state": estado instantáneo para la vista en vivo (off/supplying/pump_on).
//     El server NO lo persiste — solo actualiza el estado en memoria y lo
//     retransmite por WebSocket.
//   - "events": arreglo de eventos de auditoría de actuador derivados de la
//     transición (0..2: bomba y/o válvula), cada uno con "type" (pump_on,
//     pump_off, valve_open, valve_close) y "trigger" (autonomous | override).
//     El server SÍ los persiste en device_events (auditoría de riego).
// Una misma transición puede mover ambos actuadores (p.ej. al empezar a
// bombear se cierra la válvula NC Y se enciende la bomba), de ahí el arreglo.
static void set_supply(supply_state_t next)
{
    if (next == supply_state) {
        return;
    }

    supply_state_t prev = supply_state;

    // Cierre de tramo de bombeo: si veníamos bombeando, suma lo acumulado.
    if (prev == SUPPLY_PUMP_ON && pump_on_since_us != 0) {
        pumped_us_accum += esp_timer_get_time() - pump_on_since_us;
        pump_on_since_us = 0;
    }

    supply_state = next;

    switch (next) {
        case SUPPLY_SUPPLYING:
            valve_set(true);
            pump_set(false);
            ESP_LOGI(TAG, "Suministro: ABASTECIENDO — válvula NC abierta (LED en GPIO%d), "
                "esperando flotador", VALVE_LED_GPIO);
            break;
        case SUPPLY_PUMP_ON:
            valve_set(false);
            pump_set(true);
            pump_on_since_us = esp_timer_get_time();
            ESP_LOGI(TAG, "Suministro: BOMBA ENCENDIDA (LED en GPIO%d)", PUMP_LED_GPIO);
            break;
        case SUPPLY_OFF:
        default:
            valve_set(false);
            pump_set(false);
            // Fin real del riego: sella el cooldown sin importar el origen
            // (manual o automático). Ver run_decision (chequeo de
            // min_interval_s en vpd_threshold).
            last_watering_end_us = esp_timer_get_time();
            has_watered_since_boot = true;
            ESP_LOGI(TAG, "Suministro: APAGADO — bomba y válvula cerradas");
            break;
    }

    // El trigger de los eventos que generó esta transición sale de quién tiene
    // el control ahora mismo. En la transición a SUPPLY_OFF, stop_watering aún
    // no ha soltado el owner (lo hace DESPUÉS de este set_supply), así que el
    // pump_off/valve_close final se atribuye correctamente a quien regaba.
    const char *trigger = (owner == OWNER_MANUAL) ? "override" : "autonomous";

    bool v_prev, p_prev, v_next, p_next;
    supply_levels(prev, &v_prev, &p_prev);
    supply_levels(next, &v_next, &p_next);

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "state", supply_state_str(next));
    cJSON *events = cJSON_AddArrayToObject(root, "events");
    if (p_prev != p_next) {
        cJSON *e = cJSON_CreateObject();
        cJSON_AddStringToObject(e, "type", p_next ? "pump_on" : "pump_off");
        cJSON_AddStringToObject(e, "trigger", trigger);
        cJSON_AddItemToArray(events, e);
    }
    if (v_prev != v_next) {
        cJSON *e = cJSON_CreateObject();
        cJSON_AddStringToObject(e, "type", v_next ? "valve_open" : "valve_close");
        cJSON_AddStringToObject(e, "trigger", trigger);
        cJSON_AddItemToArray(events, e);
    }

    char *payload = cJSON_PrintUnformatted(root);
    if (payload) {
        esp_mqtt_client_publish(mqtt_client, topic_events, payload, 0, 1, 0);
        cJSON_free(payload);
    }
    cJSON_Delete(root);
}

// Tiempo total de bomba encendida en el ciclo actual (acumulado + tramo en
// curso si está bombeando ahora mismo).
static int64_t total_pumped_us(void)
{
    int64_t t = pumped_us_accum;
    if (pump_on_since_us != 0) {
        t += esp_timer_get_time() - pump_on_since_us;
    }
    return t;
}

// Mueve el suministro según el flotador: si hay solución suficiente bombea,
// si no abre la válvula NC y espera. Se llama al arrancar un riego y en cada
// sondeo mientras se riega.
static void drive_supply(void)
{
    if (float_switch_up()) {
        set_supply(SUPPLY_PUMP_ON);
    } else {
        set_supply(SUPPLY_SUPPLYING);
    }
}

// Detiene cualquier riego en curso: apaga suministro (sella cooldown), suelta
// el control y reprograma la próxima decisión desde este instante.
static void stop_watering(void)
{
    set_supply(SUPPLY_OFF);
    owner = OWNER_NONE;
}

// ============================================================
// Fotoresistor (LDR) — indicador binario de luz
// ============================================================

static void ldr_init(void)
{
    adc_oneshot_unit_init_cfg_t init_cfg = {
        .unit_id = ADC_UNIT_1,
    };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&init_cfg, &adc1_handle));

    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten    = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1_handle, LDR_ADC_CHANNEL, &chan_cfg));
}

// Devuelve la lectura cruda del ADC (0-4095 @ 12 bits) sin ninguna
// conversión — no representa lux ni ninguna unidad real, es solo para
// testing: ver cómo varía el valor al tapar/destapar el fotoresistor.
static int ldr_read_light(void)
{
    int raw = 0;
    ESP_ERROR_CHECK(adc_oneshot_read(adc1_handle, LDR_ADC_CHANNEL, &raw));
    return raw;
}

// ============================================================
// VPD (Déficit de Presión de Vapor) — ecuación de Tetens
// ============================================================
// SVP(T) = 0.6108 * exp(17.27*T / (T+237.3))  [kPa]
// VPD    = SVP(T) * (1 - RH/100)              [kPa]

static float vpd_calc_kpa(float temp_c, float humidity_pct)
{
    float svp = 0.6108f * expf(17.27f * temp_c / (temp_c + 237.3f));
    return svp * (1.0f - humidity_pct / 100.0f);
}

// ============================================================
// Luz simulada para g(Li) — ver decisión del 11 jul 2026 en
// modulo-decision.md: el LDR de este firmware da conteos crudos de ADC, no
// µmol/m²/s, así que no es comparable contra light_min/light_max del
// perfil. Mientras no haya sensor calibrado, se simula un ciclo día/noche
// corto (no depende de hora real — no hay NTP en este firmware) solo para
// poder probar el modulador end-to-end. El LDR real se sigue publicando tal
// cual en `readings.light`, sin tocar — esto NO lo reemplaza, solo
// alimenta la fórmula internamente hasta que llegue el sensor definitivo.
#define SIMULATED_LIGHT_CYCLE_US (10LL * 60 * 1000000)  // "día" sintético de 10 min

#ifndef M_PI
#define M_PI 3.14159265358979323846f
#endif

static float simulated_light_par(void)
{
    int64_t phase_us = esp_timer_get_time() % SIMULATED_LIGHT_CYCLE_US;
    float phase = (float)phase_us / (float)SIMULATED_LIGHT_CYCLE_US;  // 0..1
    float level = sinf(phase * (float)M_PI);                          // 0..1..0
    if (level < 0.0f) level = 0.0f;
    return level * 900.0f;  // rango PAR de referencia usado en firmware/simulator
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

// true si logró cargar un perfil cacheado en buf (deja buf null-terminado).
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
// hacia *out. No valida contra irrigation_methods — el server ya lo hizo antes
// de asignarlo; el firmware solo necesita los campos que usa. *out se deja en
// cero salvo los campos presentes (para que memcmp entre perfiles sea estable).
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

    cJSON *light_min = cJSON_GetObjectItem(json, "light_min");
    cJSON *light_max = cJSON_GetObjectItem(json, "light_max");
    if (cJSON_IsNumber(light_min) && cJSON_IsNumber(light_max)) {
        next.has_light_range = true;
        next.light_min = (float)light_min->valuedouble;
        next.light_max = (float)light_max->valuedouble;
    }

    cJSON *params = cJSON_GetObjectItem(json, "irrigation_params");
    if (cJSON_IsObject(params)) {
        cJSON *v;
        if ((v = cJSON_GetObjectItem(params, "threshold_vpd_kpa")) && cJSON_IsNumber(v)) {
            next.threshold_vpd_kpa = (float)v->valuedouble;
        }
        if ((v = cJSON_GetObjectItem(params, "base_duration_s")) && cJSON_IsNumber(v)) {
            next.base_duration_s = (float)v->valuedouble;
        }
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

    *out = next;
    return true;
}

static void profile_log(const crop_profile_t *p)
{
    ESP_LOGI(TAG, "Perfil activo: método=%s umbral_vpd=%.2f duracion_base=%.0f duracion_fija=%.0f intervalo_min=%.0f",
        p->irrigation_method, p->threshold_vpd_kpa,
        p->base_duration_s, p->cycle_duration_s, p->min_interval_s);
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
        // El comando solo pide regar o dejar de regar — la verificación del
        // flotador y el control de la bomba/válvula corren en irrigation_task
        // al procesar el evento, sea el origen manual o automático (ver
        // modulo-suministro.md).
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
            esp_mqtt_client_subscribe(mqtt_client, topic_commands, 1);
            esp_mqtt_client_subscribe(mqtt_client, topic_ota,      1);
            esp_mqtt_client_subscribe(mqtt_client, topic_profile,  1);
            ESP_LOGI(TAG, "Suscrito a: %s, %s, %s", topic_commands, topic_ota, topic_profile);

            totem_publish_status(mqtt_client, topic_status);
            totem_rollback_confirm();
            break;

        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGW(TAG, "MQTT desconectado");
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
                if (profile_parse(event->data, event->data_len, &ev.data.profile)) {
                    profile_save_raw(event->data, event->data_len);
                    // El perfil se aplica en irrigation_task al procesar el
                    // evento (ahí decide si "empieza de 0"). El LED solo
                    // confirma visualmente — ya no participa en el timing de
                    // la decisión (antes lo hacía vía notify, que podía
                    // latchearse y disparar riegos dobles).
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
// Publicación de lecturas reales del sensor
// ============================================================

static void publish_readings_task(void *pvParameters)
{
    bool alert_sent = false;
    char payload[256];

    while (1) {
        if (!totem_ota_in_progress()) {
            float temperature, humidity;
            esp_err_t err = totem_dht11_read(DHT_GPIO, &temperature, &humidity);

            if (err != ESP_OK) {
                ESP_LOGW(TAG, "DHT11: lectura fallida (%s) — se reintenta en el próximo ciclo",
                    esp_err_to_name(err));
            } else {
                // Entrega la lectura a irrigation_task como par atómico (T y RH
                // juntos) — antes eran dos volatile sueltos y la decisión podía
                // emparejar temperatura nueva con humedad vieja.
                irrig_ev_t ev = { .type = IRRIG_EV_READING };
                ev.data.reading.temperature = temperature;
                ev.data.reading.humidity    = humidity;
                xQueueSend(irrig_queue, &ev, 0);

                int light = ldr_read_light();
                snprintf(payload, sizeof(payload),
                    "{\"temperature\":%.1f,\"humidity\":%.1f,\"light\":%d}",
                    temperature, humidity, light);
                esp_mqtt_client_publish(mqtt_client, topic_readings, payload, 0, 1, 0);
                ESP_LOGI(TAG, "temp=%.1f hum=%.1f luz=%d | bomba=%s | alerta=%s",
                    temperature, humidity, light,
                    pump_on    ? "ON"   : "OFF",
                    alert_sent ? "ACTIVA" : "ok");

                // --- Disparar alerta al cruzar el umbral (una sola vez por ciclo) ---
                if (!alert_sent && temperature >= TEMP_ALERT) {
                    snprintf(payload, sizeof(payload),
                        "{\"type\":\"temperature_high\",\"severity\":\"warning\","
                        "\"message\":\"Temperatura critica: %.1f C (umbral: %.0f C). Activa la bomba.\"}",
                        temperature, TEMP_ALERT);
                    esp_mqtt_client_publish(mqtt_client, topic_alerts, payload, 0, 1, 0);
                    ESP_LOGW(TAG, ">>> ALERTA enviada: temperatura=%.1f°C", temperature);
                    alert_sent = true;
                }

                // --- Resetear alerta al volver al rango seguro ---
                if (alert_sent && temperature <= TEMP_SAFE) {
                    alert_sent = false;
                    ESP_LOGI(TAG, "Temperatura normalizada (%.1f°C) — alerta reseteada", temperature);
                }
            }
        }

        // El DHT11 no se puede leer más rápido que 1 vez por segundo —
        // 10s de margen es consistente con el ciclo de firmware/simulator.
        vTaskDelay(pdMS_TO_TICKS(10000));
    }
}

// ============================================================
// Ciclo de decisión automático — VPD (y timer fijo)
// ============================================================

// Programa el deadline de la próxima decisión desde AHORA, según el método.
// fixed_timer: min_interval_s es el periodo completo inicio-a-inicio; como el
// riego ocupa cycle_duration_s de ese periodo, lo que se espera antes del
// siguiente es el resto (min_interval - cycle). Como esta función se llama al
// TERMINAR el riego, el periodo real inicio-a-inicio da ~min_interval_s.
// vpd_threshold (y sin perfil): housekeeping fijo de 60s.
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
// Devuelve true si arrancó el riego (en cuyo caso el reschedule ocurre al
// terminarlo, en on_water_tick/stop_watering). Devuelve false si no regó (el
// llamador reprograma la próxima decisión).
static bool run_decision(void)
{
    if (!profile.loaded) {
        ESP_LOGI(TAG, "Decisión automática: sin perfil activo, no se riega");
        return false;
    }

    bool  should_water = false;
    float duration_s = 0.0f;

    if (strcmp(profile.irrigation_method, "fixed_timer") == 0) {
        should_water = true;
        duration_s = profile.cycle_duration_s;
    } else if (strcmp(profile.irrigation_method, "vpd_threshold") == 0) {
        // Acá min_interval_s SÍ es un enfriamiento tras terminar de regar
        // (evita re-disparo si VPD sigue sobre el umbral apenas termina un
        // riego) — distinto del uso en fixed_timer de arriba.
        if (has_watered_since_boot) {
            int64_t elapsed_s = (esp_timer_get_time() - last_watering_end_us) / 1000000LL;
            if (elapsed_s < (int64_t)profile.min_interval_s) {
                ESP_LOGI(TAG, "Decisión automática: intervalo mínimo no cumplido (%llds/%.0fs)",
                    (long long)elapsed_s, profile.min_interval_s);
                return false;
            }
        }

        if (isnan(last_temp) || isnan(last_hum)) {
            ESP_LOGI(TAG, "Decisión automática: sin lectura de T/RH todavía");
            return false;
        }
        float vpd = vpd_calc_kpa(last_temp, last_hum);
        if (vpd >= profile.threshold_vpd_kpa) {
            float f = vpd / profile.threshold_vpd_kpa;
            if (f > 2.0f) f = 2.0f;

            float light_ref = profile.has_light_range
                ? (profile.light_min + profile.light_max) / 2.0f
                : 1.0f;
            float li = profile.has_light_range ? simulated_light_par() : light_ref;
            float g = (light_ref > 0.0f) ? (li / light_ref) : 1.0f;
            if (g < 0.5f) g = 0.5f;
            if (g > 1.5f) g = 1.5f;

            should_water = true;
            duration_s = profile.base_duration_s * f * g;
            ESP_LOGI(TAG, "VPD=%.2f kPa (umbral %.2f) f=%.2f g=%.2f -> %.0fs",
                vpd, profile.threshold_vpd_kpa, f, g, duration_s);
        } else {
            ESP_LOGI(TAG, "VPD=%.2f kPa bajo el umbral %.2f — no se riega",
                vpd, profile.threshold_vpd_kpa);
        }
    } else {
        ESP_LOGW(TAG, "Decisión automática: método desconocido '%s'", profile.irrigation_method);
    }

    if (!should_water || duration_s <= 0.0f) {
        return false;
    }

    // Arranca el riego automático. La duración se mide como tiempo REAL de
    // bomba encendida (ver on_water_tick), no como reloj de pared.
    owner = OWNER_AUTO;
    target_pump_on_s = duration_s;
    pumped_us_accum  = 0;
    pump_on_since_us = 0;
    ESP_LOGI(TAG, "Riego automático iniciado — duración de bombeo objetivo: %.0fs", duration_s);
    drive_supply();
    return true;
}

// Corre la decisión y, si no arrancó riego, reprograma la próxima.
static void run_decision_and_schedule(void)
{
    if (!run_decision()) {
        schedule_next_decision();
    }
}

// Sondeo del suministro mientras se riega (cada SUPPLY_POLL_MS): re-chequea
// el flotador (por si el tanque se vació o llenó) y, para riego automático,
// corta cuando el tiempo REAL bombeado alcanza el objetivo.
static void on_water_tick(void)
{
    drive_supply();

    if (owner == OWNER_AUTO &&
        total_pumped_us() >= (int64_t)(target_pump_on_s * 1000000.0f)) {
        ESP_LOGI(TAG, "Riego automático completado (%.0fs de bombeo real)", target_pump_on_s);
        stop_watering();
        schedule_next_decision();
    }
}

// Aplica un evento recibido por la cola. Único punto donde el perfil, la
// lectura y el control (owner) se mutan por comandos externos — un solo hilo.
static void handle_event(const irrig_ev_t *ev)
{
    switch (ev->type) {
        case IRRIG_EV_READING:
            last_temp = ev->data.reading.temperature;
            last_hum  = ev->data.reading.humidity;
            have_reading = true;
            break;

        case IRRIG_EV_PROFILE: {
            // Solo re-evaluar de inmediato si el perfil realmente cambió — así
            // la re-entrega del perfil retenido en cada reconexión MQTT no
            // dispara un riego espurio. Y solo si ya hay lectura y nadie está
            // regando (si no, se aplica y el próximo ciclo lo usa).
            bool changed = !profile.loaded ||
                           memcmp(&profile, &ev->data.profile, sizeof(profile)) != 0;
            profile = ev->data.profile;
            profile_log(&profile);
            if (changed && owner == OWNER_NONE && have_reading) {
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
// recibir eventos (comandos, perfil, lecturas) Y servir de temporizador de la
// decisión/sondeo. El deadline es absoluto (next_decision_us), así los
// eventos frecuentes no corren la cadencia.
static void irrigation_task(void *pvParameters)
{
    crop_profile_t *boot = (crop_profile_t *)pvParameters;
    if (boot) {
        profile = *boot;
        profile_log(&profile);
    }

    // Primera decisión a los 15s del arranque (margen para la primera lectura).
    next_decision_us = esp_timer_get_time() + (int64_t)FIRST_DECISION_DELAY_MS * 1000;

    while (1) {
        // Cuánto esperar: mientras se riega, sondeo rápido; si no, lo que
        // falte para el deadline absoluto de la próxima decisión.
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
            // No decidir durante un OTA; empuja el deadline para no quedar en
            // bucle apretado si ya estaba vencido (evita busy-loop con wait=0).
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
    snprintf(topic_alerts,   sizeof(topic_alerts),   "totem/%s/alerts",   config.unit_id);
    snprintf(topic_events,   sizeof(topic_events),   "totem/%s/events",   config.unit_id);
    snprintf(topic_ota,      sizeof(topic_ota),      "totem/%s/ota",      config.unit_id);
    snprintf(topic_profile,  sizeof(topic_profile),  "totem/%s/profile",  config.unit_id);
    snprintf(topic_status,   sizeof(topic_status),   "totem/%s/status",   config.unit_id);

    totem_dht11_gpio_init(DHT_GPIO);
    pump_led_init();
    ldr_init();
    supply_module_init();
    totem_status_led_init();

    // Cola de eventos hacia irrigation_task — creada antes de arrancar WiFi/
    // MQTT para que el handler pueda publicar en cuanto llegue el primer
    // mensaje (perfil retenido, comando).
    irrig_queue = xQueueCreate(8, sizeof(irrig_ev_t));

    // Perfil cacheado en NVS de un arranque anterior — se carga antes de
    // conectar WiFi para poder decidir riego aunque la unidad arranque
    // offline (docs/transversal/crop-profile.md). Se entrega a irrigation_task
    // como pvParameters (no por la cola: se aplica una vez, en el init de la
    // tarea). Si nunca se recibió un perfil, boot_profile_valid queda en false
    // y el ciclo de decisión no riega hasta que llegue uno por MQTT.
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
