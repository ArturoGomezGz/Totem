# Firmware genesis (1.2.x) — riego autónomo por VPD

Primera línea de firmware Totem que lee un sensor físico y controla un actuador físico, en vez
de simular ambos como `firmware/simulator` (línea `1.0.x`). Corre en el mismo ESP32-C6 que ya
está probado en hardware — el esqueleto de WiFi/NVS/OTA/MQTT/rollback es idéntico al de
`firmware/bootstrap` y `firmware/simulator`. Ver `firmware/NON-NEGOTIABLES.md` para el contrato
completo que este firmware (y cualquier otro futuro) debe respetar para seguir siendo compatible
con el server.

## Qué cambia respecto a `firmware/simulator`

| | `simulator` (1.0.x) | `genesis` (1.1.x) |
|---|---|---|
| Temperatura/humedad | Modelo simulado (`esp_random`) | Lectura real de un sensor **RQ-S003** (módulo REXQualis basado en DHT11) |
| Luz | Simulada | Lectura real de un **fotoresistor (LDR)** — valor crudo de ADC (0-4095), solo para testing. No es confiable todavía; pendiente de reemplazo por un sensor más preciso (ver decisión del 10 jul 2026 en `docs/capa1/totem-principal/sistema-decision/modulo-decision.md`) |
| Bomba | Solo logueada (`pump_on`/`pump_off`) | LED físico en un GPIO real; el comando ya no la enciende directo, ver [Módulo de suministro simulado](#módulo-de-suministro-simulado-flotador--válvula-nc) |
| Alertas | Sobre temperatura simulada | Mismo umbral (`TEMP_ALERT`/`TEMP_SAFE`), ahora sobre temperatura real |
| Flotador / válvula NC | No existen | Simulados con un botón (flotador) y un LED (válvula NC) |

**CO₂ fue evaluado y descartado del diseño (10 jul 2026)** — no es un sensor pendiente de implementar, ver justificación en `docs/capa1/totem-principal/sistema-decision/modulo-decision.md`. El payload de `readings` ya no incluye `co2` en ninguna línea de firmware.

Los topics MQTT, el payload de `readings`, el flujo de comandos, OTA,
rollback y reporte de versión son exactamente los mismos que en `simulator`.

## Riego autónomo por VPD (1.2.0)

Antes de esta versión, `genesis` solo regaba por comando manual (`pump_on`/`pump_off`) —
el perfil recibido por MQTT se logueaba y se descartaba. A partir de 1.2.0:

1. **El perfil se parsea y se cachea en NVS** (namespace `profile`, clave `json`) — se carga
   al arrancar, antes de conectar WiFi, así la unidad puede decidir riego con el último
   perfil conocido aunque arranque offline (ver `docs/transversal/crop-profile.md`).
2. **Una tarea nueva (`irrigation_decision_task`) corre cada 3 minutos** (`DECISION_INTERVAL_MS`,
   candidato documentado en `docs/ecosistema/overview.md`) y decide si regar según
   `irrigation_method` del perfil activo:
   - `fixed_timer` — riega `cycle_duration_s` cada vez que se cumple el ciclo.
   - `vpd_threshold` — calcula VPD con la ecuación de Tetens sobre la última lectura de
     T/RH; si `VPD ≥ threshold_vpd_kpa`, riega `base_duration_s × f(VPD) × g(Li)`. Ver las
     fórmulas exactas de `f` y `g` en
     `docs/capa1/totem-principal/sistema-decision/modulo-decision.md`.
3. **Arbitraje manual vs. automático.** Un comando `pump_on` manual siempre toma el control,
   incluso si había un riego automático en curso — lo interrumpe de inmediato en vez de
   competir por la bomba. Un `pump_off` (manual o automático) sella `last_watering_end_us`;
   el ciclo automático nunca vuelve a regar antes de que pase `min_interval_s` desde ahí,
   sin importar quién disparó el riego anterior. Esto evita el caso donde un riego manual
   termina justo antes de que tocara un ciclo automático y este se dispara casi de inmediato.

**Luz simulada para `g(Li)`, no el LDR real.** El fotoresistor de este firmware da conteos
crudos de ADC (0–4095), no µmol/m²/s — no es comparable contra `light_min`/`light_max` del
perfil. Mientras no haya un sensor de luz calibrado, `g(Li)` usa un ciclo día/noche sintético
de 10 minutos (`simulated_light_par()`), solo para poder probar el modulador de principio a
fin. El LDR real se sigue publicando sin cambios en `readings.light` — no lo reemplaza, y
cuando llegue el sensor definitivo solo hay que sustituir esa función.

### Fotoresistor — nota sobre el `light` crudo

El campo `light` publica directamente la lectura cruda del ADC (0-4095 @ 12 bits) del
fotoresistor, sin ningún umbral ni conversión — solo sirve para verificar en el dashboard
que el valor efectivamente cambia con la luz ambiente. **No** es una medición calibrada de
lux ni de PAR (radiación fotosintéticamente activa): el LDR del kit RexQualis no tiene la
respuesta espectral ni la calibración necesarias para eso. Cuando el sistema de decisión de
riego necesite luz real como entrada del modelo de Pn, este sensor debe reemplazarse por uno
digital calibrado (ej. BH1750, TSL2561) o, idealmente, un sensor PAR — ver conversación de
diseño en `docs/capa1/totem-principal/sistema-decision/modulo-decision.md`.

### Módulo de suministro simulado (flotador + válvula NC)

Simula, con un botón y un LED, la verificación que describe
`docs/capa1/totem-principal/sistema-riego/modulo-suministro.md` antes de regar — sin importar
si el riego fue disparado manualmente o por el sistema de decisión automático:

1. Llega un comando `pump_on` (manual o automático) → se marca "riego solicitado", pero la
   bomba **no** se enciende todavía.
2. Una tarea (`irrigation_supply_task`) pregunta continuamente: ¿el flotador está arriba
   (solución suficiente)?
   - **Sí** → la bomba enciende directo.
   - **No** → se abre la válvula NC (LED encendido) y se queda esperando; en cuanto el
     flotador sube, se cierra la válvula y recién ahí enciende la bomba.
3. Un comando `pump_off` cancela el riego solicitado y apaga bomba y válvula de inmediato,
   en cualquier punto del proceso.

El firmware reporta 3 estados en `topic_events` (`{"action": "..."}`), uno por cada
transición real del actuador — no al recibir el comando:

| `action` | Cuándo se publica |
|---|---|
| `supplying` | Se abrió la válvula NC porque el flotador estaba abajo al pedirse riego |
| `pump_on`   | La bomba arrancó (flotador ya arriba, o justo subió mientras abastecía) |
| `pump_off`  | Todo apagado — llegó `pump_off`, o nunca se pidió riego |

Esto le permite al dashboard mostrar "Abasteciendo" mientras espera el flotador en vez de
interpretar el silencio tras el comando como que el dispositivo no respondió (ver
`server/state.py` / `frontend/src/pages/UnitDetail.jsx`, campo `pump_state`).

## Hardware

- **Placa:** ESP32-C6 SuperMini (USB-C, LED RGB WS2812 en GPIO8, botón BOOT en GPIO9 — ambos
  integrados, no expuestos en los headers).
- **Sensor:** RQ-S003 (módulo DHT11 con pull-up integrado), 3 pines: VCC, GND, DATA.
- **Sensor de luz:** fotoresistor (LDR) del kit RexQualis, como divisor de voltaje con una
  resistencia fija.
- **Actuador (bomba):** LED simple + resistencia limitadora.
- **Actuador (válvula NC):** LED simple + resistencia limitadora.
- **Flotador:** interruptor mecánico de nivel real. A diferencia de un botón normal, **cierra
  el circuito (conduce) cuando está ABAJO** y lo **abre (corta) cuando está ARRIBA**.

### Mapeo de pines confirmado sobre esta placa

Headers leídos directamente del silkscreen físico:

- Izquierda: `5V, GND, 3V3, GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5`
- Derecha: `TX, RX, GPIO14, GPIO15, GPIO18, GPIO19, GPIO20, GPIO21, GPIO22`

Asignación usada en este firmware (ver `main/genesis.c`):

| Señal | Pin |
|---|---|
| RQ-S003 DATA | **GPIO4** |
| LED (bomba) | **GPIO5** |
| LDR (nodo del divisor) | **GPIO1** (ADC1_CHANNEL_1) |
| LED (válvula NC) | **GPIO2** |
| Flotador (una pata) | **GPIO3** |
| RQ-S003 VCC | 3V3 |
| RQ-S003 GND | GND |
| LED cátodo (vía resistencia) | GND |
| Flotador (otra pata) | GND |

GPIO8 y GPIO9 quedan reservados (RGB y BOOT integrados) — no usar para periféricos externos.

### Conexión del flotador y la válvula NC (LED)

El flotador usa el pull-up interno del GPIO3, así que solo hace falta una pata a GPIO3 y la
otra a GND. **Importante:** este flotador es un interruptor que cierra el circuito (conduce)
cuando está ABAJO y lo abre (corta) cuando está ARRIBA — es decir, al revés que un botón
común. Con el pull-up interno eso se traduce en:

- Flotador **abajo** (solución insuficiente) → circuito cerrado a GND → GPIO3 en **LOW**.
- Flotador **arriba** (solución suficiente) → circuito abierto → GPIO3 en **HIGH** (pull-up).

`float_switch_up()` en `main/genesis.c` ya lee esta polaridad correctamente. Si al conectar
el flotador real el comportamiento sale invertido, verificar que no se haya cableado un
interruptor de la polaridad contraria (algunos modelos abren abajo/cierran arriba). El LED
de la válvula NC se cablea igual que el de la bomba: GPIO2 → resistencia limitadora → ánodo
del LED → cátodo a GND.

### Conexión del fotoresistor (LDR)

El LDR no genera voltaje por sí mismo — hay que armarlo como **divisor de voltaje** con una
resistencia fija (10kΩ es un buen valor de arranque; ajustar si el rango de lectura queda
muy pegado a 0 o a 4095):

```
3V3 ── LDR ── (nodo, a GPIO1) ── resistencia 10kΩ ── GND
```

1. Una pata del LDR a **3V3**.
2. La otra pata del LDR al **nodo común**.
3. Una pata de la resistencia de 10kΩ al **mismo nodo común**.
4. La otra pata de la resistencia a **GND**.
5. El nodo común (unión LDR + resistencia) a **GPIO1**.

Con esta orientación, **más luz → menos resistencia del LDR → más voltaje en el nodo →
lectura ADC más alta**. El firmware publica esa lectura cruda tal cual en `light` (0–4095,
sin umbral ni conversión), así que en el dashboard debería subir al iluminar el sensor y
bajar al taparlo. Si en cambio `light` se queda siempre pegado a 0 o a 4095, lo más probable
es que la orientación del divisor esté invertida (LDR y resistencia intercambiados) o que el
nodo común no esté realmente conectado a GPIO1 — revisar el cableado contra el diagrama de
arriba.

> Nota histórica: se probó moverlo temporalmente a GPIO18 sospechando de GPIO4
> como pin de strapping, pero el DHT11 falló igual en ambos pines — el pin
> nunca fue la causa real (ver más abajo).

## Provisioning

Idéntico al de `firmware/simulator` (mismas 5 claves NVS, mismo namespace `config`). Sigue
`firmware/simulator/PROVISIONING.md` reemplazando `firmware/simulator` por `firmware/genesis` en
los comandos de `idf.py`.

## Build y flasheo

```bash
idf.py -C firmware/genesis -p COM4 build flash monitor
```

En los logs deberías ver la misma secuencia que en `simulator` (Config cargada → WiFi conectado
→ MQTT conectado → Suscrito), seguida de lecturas reales cada 10s:

```
I (xxx) genesis: temp=24.0 hum=58.0 | bomba=OFF | alerta=ok
```

Si el DHT11 no responde (cableado flojo, timing), verás:

```
W (xxx) genesis: DHT11: lectura fallida (ESP_ERR_TIMEOUT) — se reintenta en el próximo ciclo
```

## Bug resuelto: el DHT11 nunca respondía

Al conectar el sensor real por primera vez, `dht11_read()` fallaba siempre con
timeout en la etapa `sin-respuesta(bajo)` — el DHT11 nunca bajaba la línea tras
la señal de inicio, en cualquier GPIO probado (4 y 18 por igual).

**Causa:** la señal de inicio usaba `vTaskDelay(pdMS_TO_TICKS(18))`. Con
`CONFIG_FREERTOS_HZ=100` (tick de 10ms), `pdMS_TO_TICKS` trunca por división
entera: `(18 * 100) / 1000 = 1` tick = **10ms reales**, por debajo del mínimo
de 18ms que exige el DHT11 para reconocer el inicio. El sensor ignoraba la
señal y nunca respondía — el pin era irrelevante, por eso el cambio de GPIO4 a
GPIO18 no arregló nada.

**Fix:** reemplazar ese `vTaskDelay` por `esp_rom_delay_us(20000)`, un
busy-wait de 20ms independiente del tick de FreeRTOS. Queda fuera de la
sección crítica de timing, así que WiFi/MQTT se siguen atendiendo con
normalidad durante la espera.

## Publicar como release

Igual que con `simulator` — subir el `.bin` compilado al endpoint `POST /api/v1/firmware`. La
versión se lee del binario (`version.txt` → `1.2.0`), no se escribe a mano. Al publicar el
release, marca `vpd_threshold` (y `fixed_timer`) en `supported_irrigation_methods` — ver
`docs/capa1/totem-principal/sistema-decision/modulo-decision.md` y el flujo de publicación en
`frontend/src/pages/Firmware.jsx`.
