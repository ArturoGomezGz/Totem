# Sistema de Conectividad — Totem Principal

Responsabilidad: comunicar el ESP32 con la Capa 2 via MQTT cuando hay WiFi disponible, y garantizar que ningún dato se pierda cuando no la hay.

**Protocolo decidido: MQTT con broker Mosquitto** — 23 jun 2026. Ver razonamiento en `ecosistema/overview.md`.

---

## Componentes

### Conexión MQTT

El ESP32 mantiene una conexión persistente con el broker Mosquitto. Al conectarse se suscribe a sus topics de entrada. La conexión persistente reduce el consumo energético frente a reconexiones HTTP en cada ciclo — relevante para un sistema solar.

**Topics que publica el ESP32:**

| Topic | Contenido | QoS |
|---|---|---|
| `totem/{unit_id}/readings` | Lectura de sensores (T, RH, Li) | 1 |
| `totem/{unit_id}/events` | Evento de bomba (ON/OFF, duración, trigger) | 1 |
| `totem/{unit_id}/alerts` | Alerta crítica (tanque bajo, sensor desconectado, fallo de bomba) | 1 |
| `totem/{unit_id}/status` | `{"firmware_version": "x.y.z"}` — retenido (retain=1), publicado al conectar (incluye el reinicio tras un OTA). Es como el server se entera de qué versión corre realmente el dispositivo | 1 |

**Topics a los que se suscribe el ESP32:**

| Topic | Contenido | QoS |
|---|---|---|
| `totem/{unit_id}/commands` | Comando desde Capa 2 (pump_on, pump_off, update_profile, valve_open, valve_close) | 1 |
| `totem/{unit_id}/profile` | Perfil de Cultivo Activo actualizado | 1 |
| `totem/{unit_id}/ota` | Notificación de nueva versión de firmware disponible | 1 |

**QoS 1 (at-least-once):** garantiza que cada mensaje llegue al menos una vez — el broker reintenta si no recibe ACK. Suficiente para lecturas y comandos de Totem.

### Buffer Offline

Almacena lecturas y eventos en flash cuando no hay WiFi. Al reconectar y reestablecer la sesión MQTT, los publica en orden.

🔴 Pendiente: tamaño del buffer, política de descarte (FIFO vs. drop-newest).

### OTA (Over The Air)

**Probado end-to-end en hardware físico** (ESP32-C6, no solo en el simulador de software) — incluyendo la actualización real de una versión a otra vía OTA.

El ESP32 recibe la notificación de nueva versión via topic MQTT (`totem/{unit_id}/ota`). La descarga del binario se hace via HTTP — MQTT no es adecuado para payloads grandes.

**Verificación de integridad:** hash SHA-256 del binario incluido en la notificación MQTT. El ESP32 verifica el hash antes de aplicar la actualización.

**Firma criptográfica:** diferida para post-MVP. El hash es suficiente para las primeras unidades en campo — la firma agrega valor cuando el sistema escala a instalaciones no supervisadas o infraestructura compartida.

**Confirmación de versión (reporte de estado):** tras aplicar un OTA y reiniciar, el dispositivo publica su versión al topic `totem/{unit_id}/status` (ver tabla arriba) apenas reconecta al broker. Así el dashboard puede comparar la versión reportada contra `target_firmware_release_id` (la que se quiso aplicar) y mostrar "al día" o "actualización pendiente". Antes de esto, la columna `firmware_version` en la base de datos nunca se llenaba — el dispositivo no confirmaba nada de vuelta.

**Rollback automático (anti-rollback de ESP-IDF):** si tras un OTA el nuevo firmware no logra conectar a WiFi/MQTT dentro de un margen (90 s), el bootloader revierte automáticamente a la partición anterior conocida como válida — evita dejar una unidad en campo inaccesible por un binario con bug. Requiere `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y` (ver `sdkconfig.defaults.example`).

**Firmware base de fábrica (`firmware/bootstrap`):** para evitar tener que reflashear por USB cada vez que cambia la lógica de sensores/riego, existe un binario mínimo (`firmware/bootstrap`) que solo conecta, reporta su versión (`1.0.0`) y espera el primer OTA. Es el único binario que se flashea físicamente en una unidad nueva — todo lo demás (incluidas futuras versiones del firmware con funcionalidad real, hoy en `firmware/simulator`) llega por OTA. Comparte el mismo mecanismo de NVS/provisioning y de rollback que el firmware completo.

### Last Will and Testament (LWT)

Al conectarse, el ESP32 registra un mensaje LWT en el broker. Si se desconecta abruptamente (sin corriente, WiFi caído), el broker publica automáticamente ese mensaje — el server lo recibe y puede generar una alerta de dispositivo desconectado.

---

## Autenticación con el broker

El ESP32 se autentica ante Mosquitto usando su `unit_id` como client ID y su API key como contraseña. El broker valida las credenciales antes de aceptar la conexión.

### Almacenamiento de credenciales — NVS (producción obligatorio)

Las credenciales del dispositivo (`unit_id`, `api_key`, `MQTT_BROKER_URI`, `WIFI_SSID`, `WIFI_PASSWORD`) deben almacenarse en la partición **NVS (Non-Volatile Storage)** del flash del ESP32, no compiladas en el binario.

**Por qué es obligatorio en producción:** cada unidad tiene un `unit_id` y `api_key` únicos generados por el dashboard al momento del registro. Si las credenciales van en el código compilado, habría que compilar un binario distinto por dispositivo. Con NVS se compila un único binario para todos los ESP32 y se provisionan las credenciales por separado.

**Flujo de provisioning:**
1. Admin registra la unidad en el dashboard → `POST /api/v1/units`
2. El dashboard muestra el `unit_id` y `api_key` generados
3. El técnico flashea el firmware (`ota_0`) + escribe las credenciales en la partición NVS
4. En cada arranque el firmware lee credenciales de NVS antes de conectar

**Cómo escribir en NVS desde el PC (al provisionar):**
```bash
# Generar imagen NVS con las credenciales
python $IDF_PATH/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py \
    generate nvs_config.csv nvs.bin 0x5000

# Flashear solo la partición NVS (sin tocar el firmware)
idf.py -p COM4 write-flash 0x9000 nvs.bin
```

Donde `nvs_config.csv` es:
```
key,type,encoding,value
wifi_ssid,data,string,NombreDeRed
wifi_pass,data,string,Contraseña
mqtt_uri,data,string,mqtt://192.168.1.100:1883
unit_id,data,string,uuid-del-dispositivo
api_key,data,string,api-key-generada
```

**Estado actual:** `firmware/simulator` (y `firmware/bootstrap`) ya usan NVS real para las credenciales — no Kconfig. El flujo de provisioning descrito arriba está implementado y probado en hardware físico (ESP32-C6), no solo en el simulador de software. Ver `firmware/simulator/PROVISIONING.md` para el procedimiento paso a paso.

---

## Documentos relacionados

- `ecosistema/overview.md` — decisión de protocolo cerrada
- `requirements.md` — FR-05 a FR-10
- `capa2/api-contract.md` — topics MQTT y endpoints HTTP (OTA binary, dashboard)
