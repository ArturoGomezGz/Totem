# Firmware genesis (1.1.x) — primer firmware con sensor real

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
| Luz/CO2 | Simulados | No implementados — no hay sensor físico para esto todavía |
| Bomba | Solo logueada (`pump_on`/`pump_off`) | LED físico en un GPIO real, controlado por los mismos comandos MQTT |
| Alertas | Sobre temperatura simulada | Mismo umbral (`TEMP_ALERT`/`TEMP_SAFE`), ahora sobre temperatura real |

Los topics MQTT, el payload de `readings` (menos `light`/`co2`), el flujo de comandos, OTA,
rollback y reporte de versión son exactamente los mismos que en `simulator`.

## Hardware

- **Placa:** ESP32-C6 SuperMini (USB-C, LED RGB WS2812 en GPIO8, botón BOOT en GPIO9 — ambos
  integrados, no expuestos en los headers).
- **Sensor:** RQ-S003 (módulo DHT11 con pull-up integrado), 3 pines: VCC, GND, DATA.
- **Actuador:** LED simple + resistencia limitadora, simulando la bomba.

### Mapeo de pines confirmado sobre esta placa

Headers leídos directamente del silkscreen físico:

- Izquierda: `5V, GND, 3V3, GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5`
- Derecha: `TX, RX, GPIO14, GPIO15, GPIO18, GPIO19, GPIO20, GPIO21, GPIO22`

Asignación usada en este firmware (ver `main/genesis.c`):

| Señal | Pin |
|---|---|
| RQ-S003 DATA | **GPIO4** |
| LED (bomba) | **GPIO5** |
| RQ-S003 VCC | 3V3 |
| RQ-S003 GND | GND |
| LED cátodo (vía resistencia) | GND |

GPIO8 y GPIO9 quedan reservados (RGB y BOOT integrados) — no usar para periféricos externos.

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
versión se lee del binario (`version.txt` → `1.1.0`), no se escribe a mano.
