# Contrato de API

La comunicación del sistema usa dos protocolos según el actor:

- **Dispositivos ↔ Server:** MQTT via broker Mosquitto
- **Dashboard ↔ Server:** HTTP/REST, prefijo `/api/v1/`

---

## Dispositivos ↔ Server — MQTT

### Topics que publican los dispositivos (ESP32 y simulator)

| Topic | Descripción | QoS |
|---|---|---|
| `totem/{unit_id}/readings` | Lectura de sensores (T, RH, Li, CO₂) | 1 |
| `totem/{unit_id}/events` | Evento de bomba (ON/OFF, duración, trigger) | 1 |
| `totem/{unit_id}/alerts` | Alerta crítica (tanque bajo, sensor desconectado, fallo de bomba) | 1 |

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
| `GET` | `/api/v1/firmware/{version}/binary` | Descarga el binario compilado del firmware |

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
| `POST` | `/api/v1/auth/login` | Login de usuario — devuelve JWT + refresh token |

---

## Autenticación

### Dispositivos → Broker MQTT

Cada dispositivo se autentica ante Mosquitto con:
- **Client ID:** `unit_id` de la unidad
- **Username:** `unit_id`
- **Password:** API key de la unidad (almacenada en flash del ESP32)

El broker rechaza la conexión si las credenciales son inválidas o están revocadas.

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
