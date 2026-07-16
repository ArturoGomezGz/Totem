# Firmware monitorio (1.3.x) — riego por timer fijo + sensores de gas

Firmware Totem que **replica el funcionamiento de `firmware/genesis`** (perfil de cultivo,
decisión de riego autónoma, módulo de suministro con flotador/válvula/bomba, auditoría de
eventos, buffer offline, OTA/rollback), pero **deliberadamente recortado**:

- **Sensores de gas: metano (MQ-4) y calidad de aire (Grove v1.3)** — solo monitoreo, NO
  alimentan la decisión de riego. No lee DHT11 (temperatura/humedad) ni LDR (luz). Es el "segundo
  ESP32" que menciona `genesis` donde se retiraron los sensores de gas (para no sobrecargar la
  fuente/tierra compartida con el DHT11).
- **Sin cálculo de VPD** — el único método de riego soportado es `fixed_timer`. `vpd_threshold`
  no existe aquí.
- **Lecturas cada 10 s** — publica el metano crudo a `readings`. De paso mantiene viva la señal
  en el dashboard (el server refresca `last_seen` con `readings`/`events`; el frontend marca "sin
  señal" si `last_seen` supera 35 s).

Corre en el mismo ESP32-C6 SuperMini que `genesis`, con la **misma tabla de particiones** y el
mismo `firmware/components/totem_core`. Ver `firmware/NON-NEGOTIABLES.md`.

## Timer fijo — cómo decide regar

Igual que `genesis` con `irrigation_method = fixed_timer`:

1. **El perfil se recibe por el topic `profile`, se parsea y se cachea en NVS** (namespace
   `profile`, clave `json`). Se carga al arrancar, antes de conectar WiFi, así la unidad puede
   regar con el último perfil conocido aunque arranque offline.
2. **`irrigation_task` (tarea única dueña del riego)** riega `cycle_duration_s` cada vez que se
   cumple el ciclo. `min_interval_s` es el **periodo completo inicio-a-inicio** (como un
   temporizador de jardín): el próximo riego *empieza* `min_interval_s` después del anterior, no
   `min_interval_s` después de que terminó.
3. **Módulo de suministro (flotador + válvula NC + bomba).** Antes de bombear verifica el
   flotador: si hay solución suficiente (flotador arriba) enciende la bomba; si no, abre la
   válvula NC y espera a que suba. La duración se mide como **tiempo real de bomba encendida**,
   no como reloj de pared.
4. **Arbitraje manual vs. automático.** Un `pump_on` manual toma el control incluso interrumpiendo
   un riego automático en curso; `pump_off` lo detiene y sella el cooldown.

Un perfil con un método distinto a `fixed_timer` se cachea pero no riega (se loguea como no
soportado). El server, al publicar el release, marca solo `fixed_timer` en
`supported_irrigation_methods`, así que en la práctica no debería asignarse otro método.

## Contrato con el server (topics)

| Topic | Dirección | Uso |
|---|---|---|
| `totem/{unit_id}/ota` | suscribe | Notificación de nuevo release (OTA) |
| `totem/{unit_id}/status` | publica (retain) | Versión de firmware activa |
| `totem/{unit_id}/commands` | suscribe | Comandos manuales (`pump_on`, `pump_off`) |
| `totem/{unit_id}/profile` | suscribe | Perfil de cultivo activo (fixed_timer) |
| `totem/{unit_id}/events` | publica | Auditoría de actuador + estado de suministro en vivo |
| `totem/{unit_id}/readings` | publica | Gases cada 10 s: metano y aire crudos (0-4095) + CO2 en ppm calibrado (`{"methane": <0-4095>, "air_quality": <0-4095>, "co2": <ppm>}`). `co2` se omite si el S8 no responde |

`alerts` no se usa (los gases son solo monitoreo, sin umbral de alerta en esta iteración).

## Hardware

- **Placa:** ESP32-C6 SuperMini (USB-C, LED RGB WS2812 en GPIO8, botón BOOT en GPIO9 — integrados).

Mismos pines que `genesis` (cableado intercambiable entre ambos firmwares):

| Señal | Pin |
|---|---|
| LED (bomba) | **GPIO5** |
| LED (válvula NC) | **GPIO2** |
| Flotador (una pata; la otra a GND) | **GPIO3** |
| MQ-4 metano — salida analógica (AO) | **GPIO0** (ADC1_CH0) |
| Grove calidad de aire v1.3 — salida (SIG) | **GPIO1** (ADC1_CH1) |
| Senseair S8 CO2 — ESP TX → S8 R (RxD) | **GPIO4** (UART1 TX) |
| Senseair S8 CO2 — ESP RX ← S8 T (TxD) | **GPIO14** (UART1 RX) |

El flotador usa el pull-up interno de GPIO3: cierra el circuito (LOW) cuando está **abajo**
(solución insuficiente) y lo abre (HIGH) cuando está **arriba**. GPIO8 (LED de estado) y GPIO9
(BOOT) los maneja `totem_core` — no usarlos para periféricos externos. El ESP32-C6 solo tiene ADC
en GPIO0–GPIO6; metano (GPIO0) y aire (GPIO1) ocupan el rango ADC. El S8 es UART (no ADC), así que
va en pines altos del SuperMini (GPIO4/GPIO14), que en este board expone del 0 al 5 y luego salta
al 14 (no hay GPIO6–13 accesibles).

**MQ-4 (metano):** solo se conecta la salida analógica **AO** a GPIO0; la digital (DO) se ignora
(el umbral se aplicaría en software, no en esta iteración). **Grove aire v1.3:** salida **SIG** a
GPIO1. Ambos valores se publican como conteo crudo del ADC (0–4095), sin calibrar.

**Senseair S8 (CO2, NDIR):** sensor digital por **UART/Modbus** (9600 8N1), no analógico. Entrega
**ppm ya calibrados** (no conteo crudo). Se alimenta a **5V** (G+/G0) y se comunican por UART las
líneas **R** (RxD del sensor ← ESP TX/GPIO4) y **T** (TxD del sensor → ESP RX/GPIO14). Cruce
obligado: TX de un lado al RX del otro. Se lee un único registro (IR4, función 0x04) cada 10 s y se
valida el CRC16; si el S8 no responde, `co2` se omite del payload. En pruebas, R/T son los pads 6/7
del header UART del S8: si no hay respuesta, **invertir los dos cables** (lógica 3.3V, no daña).

> ⚠️ **Cuidado con el voltaje de las salidas analógicas.** Pueden llegar hasta el voltaje de
> alimentación del módulo. Si los alimentas a **5V**, la salida puede superar los **3.3V** máximos
> del pin ADC del ESP32-C6 y **dañarlo**. Aliméntalos a **3V3** o pon un **divisor de voltaje**.
> Además el MQ-4 necesita **precalentamiento** (los primeros minutos las lecturas no son fiables)
> y consume corriente — por eso los gases van en este ESP32 aparte del DHT11.

> ⚠️ **El S8 da picos de ~300 mA al medir.** Pon un **cap de desacople (~100 µF) entre G+ y G0**,
> pegado al sensor, o el pico puede hundir el riel de 5V y **resetear el ESP** (brownout). El TxD del
> S8 es TTL **3.3V**, seguro para el ESP directo — a diferencia del AO del MQ-4, **no** necesita
> divisor en las líneas UART. La autocalibración (ABC) se deja en fábrica en esta fase de prueba.

## Provisioning

Idéntico al de `firmware/simulator` / `firmware/genesis` (mismas 5 claves NVS, namespace
`config`). Ver `firmware/simulator/PROVISIONING.md` reemplazando el nombre del proyecto.

## Build y flasheo (PowerShell)

```powershell
Remove-Item Env:MSYSTEM -ErrorAction SilentlyContinue   # el PATH de la sesión hereda MSYSTEM=MINGW64
$env:IDF_PATH = "C:\Espressif\frameworks\esp-idf-v5.5.4"
. C:\Espressif\Initialize-Idf.ps1
idf.py -C firmware\monitorio build
idf.py -C firmware\monitorio -p COM4 flash monitor
```

La versión se lee de `version.txt` — nunca se hardcodea en el código.

## Publicar como release

Igual que `simulator`/`genesis` — subir el `.bin` compilado a `POST /api/v1/firmware`. La versión
se extrae del binario, no se escribe a mano. Al publicar, marca `fixed_timer` en
`supported_irrigation_methods` (es el único método que soporta).
