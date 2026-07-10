# Contrato de API

La comunicación del sistema usa dos protocolos según el actor:

- **Dispositivos ↔ Server:** MQTT via broker Mosquitto
- **Dashboard ↔ Server:** HTTP/REST, prefijo `/api/v1/`

---

## Dispositivos ↔ Server — MQTT

### Topics que publican los dispositivos (ESP32 y simulator)

| Topic | Descripción | QoS |
|---|---|---|
| `totem/{unit_id}/readings` | Lectura de sensores (T, RH, Li) | 1 |
| `totem/{unit_id}/events` | Evento de bomba (ON/OFF, duración, trigger) | 1 |
| `totem/{unit_id}/alerts` | Alerta crítica (tanque bajo, sensor desconectado, fallo de bomba) | 1 |
| `totem/{unit_id}/status` | `{"firmware_version": "x.y.z"}` — retenido, publicado en cada conexión MQTT (incluyendo el reinicio tras un OTA). El server lo persiste en `Unit.firmware_version` | 1 |

### Topics a los que se suscriben los dispositivos

| Topic | Descripción | QoS |
|---|---|---|
| `totem/{unit_id}/commands` | Comando desde Capa 2 (pump_on, pump_off, update_profile, valve_open, valve_close) | 1 |
| `totem/{unit_id}/profile` | Perfil de Cultivo Activo completo (JSON) | 1 |
| `totem/{unit_id}/ota` | Notificación de nueva versión disponible (versión + URL de descarga + hash) | 1 |

**QoS 1 (at-least-once):** el broker reintenta hasta recibir ACK del receptor — garantía de entrega suficiente para lecturas y comandos de Totem.

### OTA — descarga de binario (HTTP)

MQTT no es adecuado para payloads binarios grandes. La notificación llega por MQTT; la descarga es HTTP:

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/v1/firmware/{firmware_release_id}/binary` | Descarga el binario compilado del firmware. Se referencia por `id`, no por `version` — `version` ya no es único globalmente, solo dentro de la organización (ver `capa2/schema.md`) |

---

## Dashboard → Server — HTTP/REST

Todos los endpoints usan el prefijo `/api/v1/`. Ver decisión y justificación de versionamiento en `capa2/stack.md`.

| Método | Endpoint | Descripción |
|---|---|---|
| `GET`  | `/api/v1/units` | Listar unidades del usuario autenticado |
| `GET`  | `/api/v1/units/{unit_id}` | Estado actual de una unidad (últimas lecturas, estado de bomba, modo) |
| `GET`  | `/api/v1/units/{unit_id}/readings` | Histórico de lecturas (con filtro de rango de fechas) |
| `GET`  | `/api/v1/units/{unit_id}/events` | Histórico de eventos de riego |
| `POST` | `/api/v1/units/{unit_id}/commands` | Enviar comando manual — el server lo publica al topic MQTT del dispositivo |
| `GET`  | `/api/v1/profiles` | Listar perfiles de cultivo disponibles |
| `POST` | `/api/v1/profiles` | Crear perfil de cultivo |
| `PUT`  | `/api/v1/profiles/{profile_id}` | Editar perfil de cultivo |
| `PUT`  | `/api/v1/units/{unit_id}/profile` | Asignar perfil activo — el server lo publica al topic MQTT del dispositivo |
| `GET`  | `/api/v1/alerts` | Historial de alertas (con filtros por unidad y estado) |
| `GET`  | `/api/v1/firmware` | Listar releases de firmware de la organización |
| `POST` | `/api/v1/firmware` | Subir un nuevo compilado (binario + versión + descripción) — solo admins |
| `POST` | `/api/v1/firmware/{firmware_release_id}/deploy` | Aplicar un release — body `{"unit_id": ...}` para una sola unidad o `{"organization_id": ...}` para todas las unidades tipo `totem` de la organización (fan-out). Crea el `command` `update_firmware` y actualiza `target_firmware_release_id` — solo admins |
| `POST` | `/api/v1/auth/login` | Login de usuario — devuelve JWT + refresh token |

---

## Autenticación

### Dispositivos → Broker MQTT

Cada dispositivo se autentica ante Mosquitto con:
- **Client ID:** `unit_id` de la unidad
- **Username:** `unit_id`
- **Password:** `api_key` de la unidad (almacenada en flash del ESP32)

La `api_key` es exclusivamente para autenticación MQTT — no es un token de la API REST. El ESP32 nunca habla con FastAPI directamente.

**Validación dinámica via `mosquitto-go-auth`:** en cada intento de conexión, Mosquitto llama al siguiente endpoint interno de FastAPI:

| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/internal/mqtt/auth` | Mosquitto valida credenciales de un dispositivo |

Payload que envía Mosquitto:
```json
{ "username": "sim-001", "password": "api_key_value", "clientid": "sim-001" }
```

FastAPI consulta la DB: si existe una unidad activa con ese `unit_id` y `api_key`, responde `200 OK`. Cualquier otro código rechaza la conexión.

Este endpoint no es accesible desde el dashboard ni desde los dispositivos — solo desde el broker dentro de la red Docker.

**Flujo de alta de un dispositivo:**
1. Admin crea la unidad desde el dashboard → `POST /api/v1/units`
2. FastAPI genera `unit_id` (UUID) y `api_key` (token aleatorio seguro) y los persiste en DB
3. El dashboard muestra las credenciales al admin para que las flashee en el ESP32
4. El ESP32 intenta conectar → Mosquitto valida contra FastAPI → conexión aceptada

**Revocación:** marcar la unidad como inactiva en DB. En la siguiente reconexión del ESP32, FastAPI responde con error y Mosquitto rechaza la conexión — sin reiniciar ningún servicio.

### Dashboard → API HTTP

```
Authorization: Bearer <jwt>
```

JWT de expiración corta (~1h) + refresh token de larga duración. Se renueva automáticamente. Si el refresh expira, el usuario vuelve a hacer login.

---

## Pendientes

- **Formato exacto de payloads MQTT** — estructura JSON de cada topic (campos, tipos, unidades). Pendiente de cerrar junto con el esquema.
- **Retained messages** — ¿El topic de perfil y comandos usa `retain=true` para que el ESP32 reciba el último valor al reconectar?
- **Paginación** — estrategia para el histórico de lecturas HTTP (cursor vs. offset).
- **Timestamps** — ISO 8601 UTC en todos los payloads (pendiente de confirmar).
- **Códigos de error HTTP** — estructura estándar de respuestas de error.
