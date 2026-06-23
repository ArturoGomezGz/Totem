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
| `totem/{unit_id}/readings` | Lectura de sensores (T, RH, Li, CO₂) | 1 |
| `totem/{unit_id}/events` | Evento de bomba (ON/OFF, duración, trigger) | 1 |
| `totem/{unit_id}/alerts` | Alerta crítica (tanque bajo, sensor desconectado, fallo de bomba) | 1 |

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

El ESP32 recibe la notificación de nueva versión via topic MQTT (`totem/{unit_id}/ota`). La descarga del binario se hace via HTTP — MQTT no es adecuado para payloads grandes.

🔴 Pendiente: verificación de firma criptográfica del binario (además del hash).

### Last Will and Testament (LWT)

Al conectarse, el ESP32 registra un mensaje LWT en el broker. Si se desconecta abruptamente (sin corriente, WiFi caído), el broker publica automáticamente ese mensaje — el server lo recibe y puede generar una alerta de dispositivo desconectado.

---

## Autenticación con el broker

El ESP32 se autentica ante Mosquitto usando su `unit_id` como client ID y su API key como contraseña. El broker valida las credenciales antes de aceptar la conexión.

---

## Documentos relacionados

- `ecosistema/overview.md` — decisión de protocolo cerrada
- `requirements.md` — FR-05 a FR-10
- `capa2/api-contract.md` — topics MQTT y endpoints HTTP (OTA binary, dashboard)
