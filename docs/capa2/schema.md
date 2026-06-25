# Esquema de Base de Datos

TimescaleDB (extensión de PostgreSQL). Stack completo en `docs/capa2/stack.md`.

**Estado:** cerrado · 24 jun 2026 · revisado 25 jun 2026 (normalización y constraints)

---

## Tablas

### `users`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `email` | VARCHAR UNIQUE NOT NULL | |
| `password_hash` | VARCHAR NOT NULL | |
| `created_at` | TIMESTAMPTZ NOT NULL | |

### `organizations`

Agrupa unidades y usuarios bajo una misma cuenta. Un usuario puede pertenecer a múltiples organizaciones.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `name` | VARCHAR NOT NULL | Nombre legible asignado por el creador |
| `created_at` | TIMESTAMPTZ NOT NULL | |

### `memberships` *(tabla pivote)*

Relación many-to-many entre usuarios y organizaciones. El primer usuario en crear una organización se registra automáticamente con rol `admin`.

| Campo | Tipo | Notas |
|---|---|---|
| `user_id` | UUID FK → users | |
| `organization_id` | UUID FK → organizations | |
| `role` | VARCHAR NOT NULL | `admin` o `member` |
| `joined_at` | TIMESTAMPTZ NOT NULL | |

Clave primaria compuesta: `(user_id, organization_id)`.

### `units`

Tabla base genérica para cualquier tipo de unidad del sistema. Campos específicos por tipo viven en su propia tabla de configuración.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `organization_id` | UUID FK → organizations | |
| `type` | VARCHAR NOT NULL | `totem`, `supply_tank` |
| `name` | VARCHAR NOT NULL | Nombre legible asignado por el usuario |
| `api_key` | VARCHAR UNIQUE NOT NULL | Contraseña MQTT del dispositivo — no es un token de API REST |
| `is_active` | BOOLEAN NOT NULL DEFAULT true | False = unidad revocada, Mosquitto rechaza la conexión |
| `firmware_version` | VARCHAR | Última versión reportada por el dispositivo |
| `last_seen` | TIMESTAMPTZ | Último ciclo de comunicación exitoso |
| `created_at` | TIMESTAMPTZ NOT NULL | |

### `totem_configs`

Configuración específica de unidades tipo `totem`. Relación 1:1 con `units`.

| Campo | Tipo | Notas |
|---|---|---|
| `unit_id` | UUID PK FK → units | |
| `active_profile_id` | UUID FK → crop_profiles | Nullable — sin perfil asignado aún |

### `readings` *(hypertable TimescaleDB)*

Tabla ancha — una columna por tipo de sensor. Agregar un sensor nuevo = `ALTER TABLE ADD COLUMN`.

Todas las columnas de sensores son nullable. `NULL` no significa fallo de lectura — significa que esa unidad no tiene ese sensor instalado. Esto permite que distintas configuraciones de hardware publiquen solo las variables que miden, sin que el schema lo impida. El módulo de decisión y las alertas deben ignorar los campos `NULL` al evaluar umbrales del perfil de cultivo.

| Campo | Tipo | Notas |
|---|---|---|
| `unit_id` | UUID FK → units | |
| `timestamp` | TIMESTAMPTZ NOT NULL | Timestamp de la lectura en el dispositivo |
| `temperature` | FLOAT | °C — nullable |
| `humidity` | FLOAT | % RH — nullable |
| `light` | FLOAT | PAR / PPFD (µmol/m²/s) — nullable |
| `co2` | FLOAT | ppm — nullable |

Clave primaria compuesta: `(unit_id, timestamp)`. Particionado automático por tiempo via TimescaleDB.

### `device_events`

Registro unificado de actuadores. Duración de ciclos de bomba se calcula como diferencia entre `pump_off` y su `pump_on` anterior.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `unit_id` | UUID FK → units | |
| `timestamp` | TIMESTAMPTZ NOT NULL | |
| `type` | VARCHAR NOT NULL | `pump_on`, `pump_off`, `valve_open`, `valve_close` |
| `trigger` | VARCHAR NOT NULL | `autonomous` o `override` |

### `crop_profiles`

Parametrizan el Módulo de Decisión de Riego. Los perfiles son privados por organización.

Los rangos ambientales son nullable — `NULL` significa que esa variable no aplica para esta configuración (sensor no instalado o no relevante para el cultivo). El método de riego y sus parámetros son libres por diseño: agregar un nuevo método no requiere cambios en el schema.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `organization_id` | UUID FK → organizations | |
| `name` | VARCHAR NOT NULL | ej. "Albahaca — etapa vegetativa" |
| `species` | VARCHAR | |
| `temp_min` | FLOAT | °C — nullable |
| `temp_max` | FLOAT | °C — nullable |
| `humidity_min` | FLOAT | % RH — nullable |
| `humidity_max` | FLOAT | % RH — nullable |
| `light_min` | FLOAT | PAR — nullable |
| `light_max` | FLOAT | PAR — nullable |
| `co2_min` | FLOAT | ppm — nullable |
| `co2_max` | FLOAT | ppm — nullable |
| `irrigation_method` | VARCHAR NOT NULL | ej. `pn_threshold`, `fixed_timer`, `lookup_table` |
| `irrigation_params` | JSONB NOT NULL | Parámetros libres según el método activo |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `updated_at` | TIMESTAMPTZ NOT NULL | Se actualiza en cada PUT /api/v1/profiles/{id} |

### `commands`

Historial de comandos enviados por unidad. Con MQTT los comandos se entregan por push al topic `totem/{unit_id}/commands` — fire-and-forget, sin ACK del dispositivo. La tabla funciona como registro de auditoría: quién envió qué, cuándo, y si llegó al broker.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `unit_id` | UUID FK → units | |
| `issued_by` | UUID FK → users | Usuario que emitió el comando |
| `type` | VARCHAR NOT NULL | `pump_on`, `pump_off`, `pause_autonomous`, `update_profile`, `valve_open`, `valve_close` |
| `payload` | JSONB | Parámetros del comando |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `delivered_at` | TIMESTAMPTZ | Timestamp de publicación MQTT exitosa al broker |

### `alerts`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `unit_id` | UUID FK → units | |
| `timestamp` | TIMESTAMPTZ NOT NULL | |
| `type` | VARCHAR NOT NULL | Campo libre — sin enum. Valores iniciales: `tank_low`, `sensor_disconnected`, `pump_failure` |
| `severity` | VARCHAR NOT NULL | `critical` o `warning` |
| `message` | TEXT | |
| `resolved_at` | TIMESTAMPTZ | Nullable — timestamp de resolución. El ESP32 publica la resolución cuando la condición desaparece |
| `telegram_sent_at` | TIMESTAMPTZ | Nullable — `NULL` = notificación Telegram pendiente, timestamp = entregada. Al arrancar el server reintenta las pendientes |

### `refresh_tokens`

Sesiones de larga duración. Permite invalidar sesiones individuales sin esperar a que expire el JWT.

| Campo | Tipo | Notas |
|---|---|---|
| `token_hash` | VARCHAR PK | Hash del refresh token — el token en claro nunca se almacena |
| `user_id` | UUID FK → users | |
| `expires_at` | TIMESTAMPTZ NOT NULL | |
| `revoked_at` | TIMESTAMPTZ | Nullable — `NULL` = token activo |

### `firmware_releases`

Metadatos de versiones de firmware publicadas para OTA. El binario `.bin` vive en el filesystem del server (volumen Docker); la DB guarda solo los metadatos.

| Campo | Tipo | Notas |
|---|---|---|
| `version` | VARCHAR PK | Versión semántica — ej. `1.2.0` |
| `binary_path` | VARCHAR NOT NULL | Path relativo al binario en el filesystem del server — ej. `data/firmware/totem-v1.2.0.bin` |
| `sha256` | VARCHAR NOT NULL | Hash SHA-256 del binario para verificación de integridad en el ESP32 |
| `released_at` | TIMESTAMPTZ NOT NULL | |

---

## Relaciones

```
users
  ├── memberships (rol: admin | member)
  │     └── organizations
  │           ├── units (genérico: totem, supply_tank, etc.)
  │           │     ├── totem_configs  (1:1, solo type = totem)
  │           │     ├── readings       (1 unidad → N lecturas)
  │           │     ├── device_events  (1 unidad → N eventos de actuadores)
  │           │     ├── commands       (1 unidad → N comandos, issued_by → users)
  │           │     └── alerts         (1 unidad → N alertas)
  │           └── crop_profiles (privados por organización)
  │                 └── totem_configs (perfil activo por totem)
  └── refresh_tokens (sesiones de larga duración)

firmware_releases (global — no pertenece a una organización)
```

---

## Notas de diseño

### Nivel de tanque — no se persiste en `readings`

El nivel del tanque se gestiona únicamente a través de alertas y control de la válvula. No existe columna `tank_level` en la tabla `readings`.

**Dos flotadores digitales** montados en el tanque a ~30% y ~90% de capacidad:

| flotador_alto (90%) | flotador_bajo (30%) | Estado | Acción del sistema |
|---|---|---|---|
| Sumergido | Sumergido | Lleno (> 90%) | Válvula cerrada, LED verde |
| En aire | Sumergido | Normal (30–90%) | Sin acción |
| En aire | En aire | Bajo (< 30%) | Válvula abierta, LED rojo, alerta Telegram |

Las lecturas de los flotadores no viajan en el payload de `/readings` — el ESP32 actúa localmente de forma inmediata y genera una alerta via `/alerts` solo cuando el flotador del 30% se activa.

---

## Análisis de normalización y decisiones de constraints

Revisión exhaustiva realizada el 25 jun 2026. El esquema cumple 1NF, 2NF y 3NF. A continuación se documentan los hallazgos y las decisiones de implementación.

### Normalización

**1NF — cumplida.** Todos los valores son atómicos. `irrigation_params` es JSONB libre por decisión de diseño explícita (ver nota en la tabla), no una violación.

**2NF — cumplida.** En las tablas con PK compuesta:
- `memberships (user_id, organization_id)`: `role` y `joined_at` dependen del par completo.
- `readings (unit_id, timestamp)`: todos los campos de sensores dependen del par completo.

**3NF — cumplida.** No hay dependencias transitivas. La FK `totem_configs.active_profile_id → crop_profiles` podría parecer una dependencia transitiva entre organizaciones, pero no lo es: es una FK directa con una restricción de integridad entre organizaciones que se aplica en la capa de aplicación (ver abajo).

### Integridad entre organizaciones (restricción no expresable con FK simple)

`totem_configs.active_profile_id` referencia `crop_profiles`, pero **no puede expresarse via FK** que el perfil pertenezca a la misma organización que la unidad. PostgreSQL no soporta CHECK constraints que crucen tablas.

**Regla de negocio que la aplicación (FastAPI) debe hacer cumplir:** antes de asignar `active_profile_id`, verificar que `crop_profiles.organization_id = units.organization_id` para esa unidad. Este check debe ejecutarse en el endpoint `PUT /api/v1/units/{unit_id}/profile`.

Análogamente, `totem_configs` solo debe crearse para unidades con `type = 'totem'`. Tampoco expresable con FK — la aplicación lo garantiza.

### Constraints añadidos en el SQL (ausentes en el diseño original)

| Tabla | Constraint | Valores válidos / regla |
|---|---|---|
| `memberships` | `CHECK (role IN (...))` | `admin`, `member` |
| `units` | `CHECK (type IN (...))` | `totem`, `supply_tank` |
| `device_events` | `CHECK (type IN (...))` | `pump_on`, `pump_off`, `valve_open`, `valve_close` |
| `device_events` | `CHECK (trigger IN (...))` | `autonomous`, `override` |
| `commands` | `CHECK (type IN (...))` | los seis tipos definidos |
| `alerts` | `CHECK (severity IN (...))` | `critical`, `warning` |
| `crop_profiles` | `CHECK (temp_min <= temp_max)` etc. | rangos coherentes para cada variable (solo cuando ambos extremos están presentes) |
| varias | `CHECK (campo <> '')` | campos VARCHAR NOT NULL no pueden ser string vacío |

`alerts.type` permanece libre (sin CHECK) por diseño — los tipos de alerta evolucionan sin migraciones.

### Campo añadido: `crop_profiles.updated_at`

El endpoint `PUT /api/v1/profiles/{profile_id}` edita perfiles. Sin `updated_at` no hay forma de saber cuándo se modificó un perfil por última vez, ni de detectar conflictos de edición concurrente en el futuro. Campo añadido como `TIMESTAMPTZ NOT NULL DEFAULT NOW()`.

### `api_key` en texto plano

`units.api_key` se almacena en texto plano porque Mosquitto necesita comparar el valor exacto recibido del ESP32 en cada intento de conexión. Si en el futuro se migra a comparación con hash, el plugin `mosquitto-go-auth` debe actualizarse en consecuencia. El valor es un token aleatorio largo — la exposición se limita a que un atacante con acceso a la DB podría suplantar un dispositivo.

### `commands.issued_by` — ON DELETE RESTRICT

El historial de auditoría debe permanecer intacto. Si se requiere anonimizar un usuario (GDPR), la aplicación debe hacer `UPDATE commands SET issued_by = <anon_user_id>` antes del DELETE del usuario real.

### ON DELETE policies de FKs

| FK | Policy | Razón |
|---|---|---|
| `memberships → users` | CASCADE | Si el usuario se borra, sus membresías desaparecen con él |
| `memberships → organizations` | CASCADE | Si la org se borra, sus membresías desaparecen |
| `units → organizations` | RESTRICT | No borrar una org que todavía tiene unidades activas |
| `totem_configs → units` | CASCADE | La config es parte de la unidad — muere con ella |
| `totem_configs → crop_profiles` | SET NULL | Si el perfil se borra, la unidad queda sin perfil (nullable) |
| `crop_profiles → organizations` | RESTRICT | No borrar una org que todavía tiene perfiles |
| `readings → units` | CASCADE | Las lecturas no tienen valor sin su unidad |
| `device_events → units` | CASCADE | Ídem |
| `commands → units` | CASCADE | Ídem |
| `commands → users` | RESTRICT | Auditoría — ver nota arriba |
| `alerts → units` | CASCADE | Ídem |
| `refresh_tokens → users` | CASCADE | Si el usuario se borra, sus tokens desaparecen |

### Índices

| Índice | Tabla | Propósito |
|---|---|---|
| Implícito (UNIQUE) | `users.email` | Login |
| Implícito (UNIQUE) | `units.api_key` | Autenticación MQTT (path crítico) |
| `idx_memberships_organization_id` | `memberships` | Listar miembros de una org |
| `idx_units_organization_id` | `units` | Listar unidades de una org |
| `idx_crop_profiles_organization_id` | `crop_profiles` | Listar perfiles de una org |
| `idx_totem_configs_active_profile_id` | `totem_configs` | Encontrar unidades que usan un perfil |
| `idx_readings_unit_timestamp` | `readings` | Histórico y últimas lecturas por unidad |
| `idx_device_events_unit_timestamp` | `device_events` | Historial de eventos por unidad |
| `idx_commands_unit_created_at` | `commands` | Historial de comandos por unidad |
| `idx_commands_pending` | `commands` | Cola de reintento (WHERE delivered_at IS NULL) |
| `idx_alerts_unit_timestamp` | `alerts` | Historial de alertas por unidad |
| `idx_alerts_timestamp` | `alerts` | Vista global de alertas recientes |
| `idx_alerts_telegram_pending` | `alerts` | Cola de notificaciones Telegram pendientes |
| `idx_refresh_tokens_user_id` | `refresh_tokens` | Logout de todas las sesiones de un usuario |

### TimescaleDB — chunk_time_interval

`readings` usa `chunk_time_interval = 7 days`. Con lecturas cada 1–5 minutos por unidad, un chunk semanal produce ~2 000–10 000 filas por unidad por chunk — tamaño manejable para compresión y queries. Si el sistema crece a cientos de unidades simultáneas, reducir a `1 day`.
