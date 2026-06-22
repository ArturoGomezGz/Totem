# Contrato de API

Todos los endpoints usan el prefijo `/api/v1/`. Ver decisión y justificación en `docs/stack.md`.

Decisiones pendientes que bloquean completar este documento:
- Protocolo ESP32 ↔ server (HTTP/REST vs. MQTT)
- Esquema de base de datos (bloquea definir payloads exactos)
- Mecanismo de autenticación de dispositivos

---

## Grupos de endpoints

### Dispositivos → Server (ESP32 y simulator)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/v1/readings` | Enviar lectura de sensores (T, RH, Li, CO₂, nivel de tanque) |
| `POST` | `/api/v1/events` | Enviar evento de actuación de bomba (ON/OFF, duración, timestamp) |
| `POST` | `/api/v1/alerts` | Enviar alerta generada por el dispositivo (sensor desconectado, tanque bajo, etc.) |
| `GET`  | `/api/v1/units/{unit_id}/commands` | Consultar comandos pendientes para la unidad (override, cambio de perfil) |
| `GET`  | `/api/v1/units/{unit_id}/profile` | Obtener el perfil de cultivo activo asignado a la unidad |
| `GET`  | `/api/v1/firmware/latest` | Consultar si existe una versión de firmware más reciente (OTA) |

### Dashboard → Server (frontend)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET`  | `/api/v1/units` | Listar unidades Totem del usuario autenticado |
| `GET`  | `/api/v1/units/{unit_id}` | Estado actual de una unidad (últimas lecturas, estado de bomba, modo) |
| `GET`  | `/api/v1/units/{unit_id}/readings` | Histórico de lecturas (con filtro de rango de fechas) |
| `GET`  | `/api/v1/units/{unit_id}/events` | Histórico de eventos de riego |
| `POST` | `/api/v1/units/{unit_id}/commands` | Enviar comando manual (forzar bomba ON/OFF, pausar modo autónomo) |
| `GET`  | `/api/v1/profiles` | Listar perfiles de cultivo disponibles |
| `POST` | `/api/v1/profiles` | Crear perfil de cultivo |
| `PUT`  | `/api/v1/profiles/{profile_id}` | Editar perfil de cultivo |
| `PUT`  | `/api/v1/units/{unit_id}/profile` | Asignar perfil activo a una unidad |
| `GET`  | `/api/v1/alerts` | Historial de alertas (con filtros por unidad y estado) |

### Autenticación

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/v1/auth/login` | Login de usuario (dashboard) |
| `POST` | `/api/v1/auth/token` | Autenticación de dispositivo ESP32 |

---

## Notas pendientes de definir

- **Formato exacto de payloads** — campos, tipos y unidades de cada endpoint. Bloqueado por: esquema de DB.
- **Autenticación de dispositivos** — mecanismo concreto (API key por unidad, JWT, otro). Bloqueado por: decisión de protocolo.
- **Paginación** — estrategia para el histórico de lecturas (cursor vs. offset).
- **Formato de timestamps** — ISO 8601 UTC en todos los payloads (pendiente de confirmar).
- **Códigos de error** — estructura estándar de respuestas de error.
