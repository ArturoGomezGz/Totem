# Esquema de Base de Datos

TimescaleDB (extensión de PostgreSQL). Stack completo en `docs/capa2/stack.md`.

**Estado:** cerrado · 24 jun 2026 · revisado 25 jun 2026 (normalización y constraints) · revisado 2 jul 2026 (gestión de firmware por organización) · revisado 9 jul 2026 (relación tanque de suministro ↔ totems, tabla `supply_tank_configs`, columnas `ph`/`ec`/`tank_level` en `readings`)

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
| `target_firmware_release_id` | UUID FK → firmware_releases | Nullable — versión que el admin quiere que la unidad ejecute. Distinto de `firmware_version` (lo que el dispositivo reporta tener instalado). El dashboard compara ambos para mostrar "al día" / "actualización pendiente" |
| `last_seen` | TIMESTAMPTZ | Último ciclo de comunicación exitoso |
| `created_at` | TIMESTAMPTZ NOT NULL | |

### `totem_configs`

Configuración específica de unidades tipo `totem`. Relación 1:1 con `units`.

| Campo | Tipo | Notas |
|---|---|---|
| `unit_id` | UUID PK FK → units | |
| `active_profile_id` | UUID FK → crop_profiles | Nullable — sin perfil asignado aún |
| `supply_tank_id` | UUID FK → units | Nullable — tanque padre (`type = 'supply_tank'`) del que se abastece este Totem por gravedad. `NULL` = llenado manual (MVP) o sin tanque padre asignado. Relación 1 tanque → N totems; no es many-to-many porque físicamente un Totem se abastece de un solo tanque a la vez (una manguera). Puramente informativa para el dashboard — no afecta el comportamiento físico del Totem, que decide su propio llenado vía su flotador y válvula NC sin depender de que el server conozca esta relación |

### `supply_tank_configs`

Configuración específica de unidades tipo `supply_tank`. Relación 1:1 con `units` — mismo patrón que `totem_configs`.

| Campo | Tipo | Notas |
|---|---|---|
| `unit_id` | UUID PK FK → units | |
| `capacity_liters` | FLOAT | Nullable — capacidad total del tanque. Permite estimar volumen aproximado a partir de los 3 flotadores y calcular autonomía (días restantes) combinando con histórico de consumo |
| `ph_min` / `ph_max` | FLOAT | Nullable — rango aceptable de pH. Fuera de rango dispara alerta |
| `ec_min` / `ec_max` | FLOAT | Nullable — rango aceptable de EC (mS/cm). Fuera de rango dispara alerta |

**Decisión — 9 jul 2026.** Los rangos de `ph_min/max` y `ec_min/max` son **explícitos y manuales por tanque, no derivados de los perfiles de cultivo de los totems que abastece**. Razón: un tanque tiene una única composición física de solución; si abastece totems con cultivos de necesidades muy distintas (ej. hoja verde ~0.8–1.2 mS/cm vs. frutales ~2.0–3.5 mS/cm — rangos que no se solapan), no existe un único rango "correcto" derivable automáticamente — la composición real del tanque es la que determina qué cultivos puede alimentar, no al revés. Ver investigación y fuentes en `capa1/tanque-de-suministro/sistema-tanque-suministro.md`.

Un módulo de cálculo/sugerencia automática de rango (a partir de los perfiles de cultivo conectados) queda como feature planificada que vive **sobre** este esquema, sin modificarlo — ver `docs/planned-features.md` § "Cálculo automático de rango EC/pH sugerido".

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
| `ph` | FLOAT | Nullable — reportado tanto por `totem` (FR-43) como por `supply_tank` |
| `ec` | FLOAT | mS/cm — nullable — reportado tanto por `totem` (FR-43) como por `supply_tank` |
| `tank_level` | FLOAT | Nullable — solo `supply_tank` (nivel discreto derivado de los 3 flotadores, ver `capa1/tanque-de-suministro/modulo-flotadores.md`). El Totem no reporta nivel — su flotador único es control local, no telemetría |
| `air_quality` | FLOAT | Nullable — Grove Air Quality Sensor v1.3 (índice genérico de calidad de aire). Conteo crudo del ADC (0-4095) **sin calibrar** — fase de prueba, solo monitoreo |
| `methane` | FLOAT | Nullable — MQ-4 (salida analógica AO). Conteo crudo del ADC (0-4095) **sin calibrar** — fase de prueba, solo monitoreo |

Clave primaria compuesta: `(unit_id, timestamp)`. Particionado automático por tiempo via TimescaleDB.

**Decisión — 14 jul 2026.** Se agregan `air_quality` (Grove Air Quality Sensor v1.3) y `methane` (MQ-4) como sensores de prueba proporcionados por el profesor colaborador. Estatus: **solo monitoreo — no alimentan la decisión de riego** (a diferencia de T/RH/Li). Se guarda el conteo crudo del ADC del ESP32 (0-4095), sin calibrar: en esta fase interesa validar el pipeline end-to-end (firmware → MQTT → DB → dashboard), y la conversión a unidades reales (ppm, índice) queda para una versión posterior de firmware distribuible por OTA. Implementado en `firmware/genesis` 1.5.0 (migración `c3e7a1f9b8d2`). En el ESP32-C6 ambos van forzosamente en pines con ADC (GPIO0 y GPIO2); GPIO2 se liberó moviendo el LED de la válvula a GPIO18.

**Decisión — 9 jul 2026 (revisa la nota original que suponía `ph`/`ec` exclusivos del tanque padre).** `ph` y `ec` los reporta **tanto el Totem como el tanque padre** — el Totem mide la solución que realmente recibe la raíz (punto de entrega real), que puede diferir del tanque padre por evaporación u otros factores; ver FR-43 y `capa1/totem-principal/sistema-decision/modulo-lectura-sensores.md`. `tank_level` sigue siendo exclusivo del tanque padre, porque el nivel del Totem no se reporta (control local vía un solo flotador, ver `capa1/totem-principal/sistema-riego/modulo-suministro.md`).

Estas columnas siguen el mismo patrón nullable que el resto: `NULL` significa "esta unidad no tiene ese sensor instalado", no fallo de lectura. Está respaldado por dos razones:

1. **Costo de almacenamiento negligible.** La compresión columnar de TimescaleDB almacena columnas de `NULL` con costo casi cero. A cualquier escala razonable del proyecto, las columnas vacías no tienen impacto en el tamaño de la DB.
2. **Queries simples.** El campo `units.type` (`totem` / `supply_tank`) distingue el tipo de dispositivo cuando hace falta filtrar, pero no es estrictamente necesario para columnas que ambos tipos pueden usar (`ph`, `ec`) — a diferencia de `tank_level`, que sí es exclusivo de `supply_tank`.

El `ALTER TABLE ADD COLUMN` en TimescaleDB no requiere migración compleja ni downtime — estas columnas se agregan cuando se implemente el sensor correspondiente, no antes.

### `device_events`

Registro unificado de actuadores. Cada evento de cierre (`pump_off`, `valve_close`) trae `duration_s`: la duración exacta del tramo que termina, medida por el firmware con el reloj monótono del ESP32 (fuente autoritativa, robusta al buffer offline). El firmware ≥1.4.2 la reporta; los eventos de apertura (`pump_on`, `valve_open`) y los históricos previos la dejan en `NULL`. `pump_off.duration_s` = tiempo de bombeo del ciclo; `valve_close.duration_s` = tiempo de llenado.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `unit_id` | UUID FK → units | |
| `timestamp` | TIMESTAMPTZ NOT NULL | Instante de recepción en el server |
| `type` | VARCHAR NOT NULL | `pump_on`, `pump_off`, `valve_open`, `valve_close` |
| `trigger` | VARCHAR NOT NULL | `autonomous` o `override` |
| `duration_s` | FLOAT NULL | Solo en cierres: segundos del tramo (bombeo / llenado). `CHECK (>= 0)` |

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
| `irrigation_method` | VARCHAR NOT NULL | ej. `vpd_threshold`, `fixed_timer`, `lookup_table` |
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
| `type` | VARCHAR NOT NULL | `pump_on`, `pump_off`, `pause_autonomous`, `update_profile`, `valve_open`, `valve_close`, `update_firmware` |
| `payload` | JSONB | Parámetros del comando. Para `update_firmware`: `{"firmware_release_id": "...", "version": "..."}` — el server resuelve `binary_path`/`sha256` desde `firmware_releases` al momento de publicar al topic `totem/{unit_id}/ota` |
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

Metadatos de versiones de firmware publicadas para OTA. El binario `.bin` vive en el filesystem del server (volumen Docker); la DB guarda solo los metadatos. Los releases son privados por organización — cada organización sube y gestiona sus propios compilados.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `organization_id` | UUID FK → organizations NOT NULL | |
| `version` | VARCHAR NOT NULL | Versión semántica — ej. `1.2.0`. Única dentro de la organización, no globalmente (`UNIQUE (organization_id, version)`) |
| `description` | TEXT | Nullable — notas libres del admin sobre el release (ej. "fix de lectura de humedad", "cambio de intervalo de ciclo"). Ayuda al usuario a distinguir versiones en el dashboard |
| `binary_path` | VARCHAR NOT NULL | Path relativo al binario en el filesystem del server — ej. `data/firmware/{organization_id}/totem-v1.2.0.bin` |
| `sha256` | VARCHAR NOT NULL | Hash SHA-256 del binario para verificación de integridad en el ESP32 |
| `uploaded_by` | UUID FK → users | Admin que subió el compilado |
| `released_at` | TIMESTAMPTZ NOT NULL | |

---

## Relaciones

```
users
  ├── memberships (rol: admin | member)
  │     └── organizations
  │           ├── units (genérico: totem, supply_tank, etc.)
  │           │     ├── totem_configs  (1:1, solo type = totem)
  │           │     │     └── supply_tank_id → units (type = supply_tank, N totems → 1 tanque)
  │           │     ├── supply_tank_configs  (1:1, solo type = supply_tank)
  │           │     ├── readings       (1 unidad → N lecturas)
  │           │     ├── device_events  (1 unidad → N eventos de actuadores)
  │           │     ├── commands       (1 unidad → N comandos, issued_by → users)
  │           │     ├── alerts         (1 unidad → N alertas)
  │           │     └── target_firmware_release_id → firmware_releases
  │           ├── crop_profiles (privados por organización)
  │           │     └── totem_configs (perfil activo por totem)
  │           └── firmware_releases (privados por organización, uploaded_by → users)
  └── refresh_tokens (sesiones de larga duración)
```

---

## Notas de diseño

### Nivel de tanque — distinto tratamiento en Totem vs. tanque padre

**Decisión — 9 jul 2026 (revisa la nota original de dos flotadores, ver `ecosistema/overview.md`).**

**Totem (tanque hijo):** el nivel **no se persiste en `readings`** — se gestiona únicamente a través de alertas y control local de la válvula, con **un solo flotador** (no dos):

| Flotador | Estado | Acción del sistema |
|---|---|---|
| Sumergido | Nivel suficiente | Válvula cerrada, LED verde |
| En aire | Nivel bajo | Válvula abierta, LED rojo, alerta Telegram |

La lectura del flotador no viaja en el payload de `/readings` — el ESP32 actúa localmente de forma inmediata y genera una alerta via `/alerts` solo cuando el flotador queda en el aire. Ver `capa1/totem-principal/sistema-riego/modulo-suministro.md`.

**Tanque padre (abastecimiento):** el nivel **sí se persiste en `readings.tank_level`** como serie de tiempo, con **tres flotadores** para mayor granularidad (4 escalones: vacío/bajo/medio/lleno) — aquí sí interesa el histórico para graficar consumo y estimar autonomía. Ver `capa1/tanque-de-suministro/modulo-flotadores.md`.

### Gestión de firmware por organización

**Decisión — 2 jul 2026.** `firmware_releases` pasa de ser una tabla global a ser privada por organización: cada organización compila y sube sus propios binarios, así que dos organizaciones pueden publicar cada una una versión `1.2.0` sin colisionar entre sí. Por eso la PK deja de ser `version` y pasa a un `id` propio con `UNIQUE (organization_id, version)`.

**Aplicar un release a una unidad o a toda la organización no requiere una tabla nueva de despliegues.** Se reutiliza el mecanismo de `commands` que ya existe para el resto de acciones fire-and-forget (pump_on, update_profile, etc.):

1. El admin sube un compilado → `firmware_releases` (con `description` para que el dashboard distinga versiones sin que el usuario tenga que interpretar el número de versión).
2. El admin aplica ese release a una unidad, o a todas las unidades tipo `totem` de la organización → por cada unidad afectada se crea una fila en `commands` con `type = update_firmware` y se actualiza `units.target_firmware_release_id`.
3. El server publica la notificación OTA al topic MQTT `totem/{unit_id}/ota` (versión, URL de descarga, hash) y marca `commands.delivered_at` al publicar exitosamente — igual que cualquier otro comando.
4. Cuando el ESP32 reporta la nueva versión instalada, `units.firmware_version` se actualiza. El dashboard compara `firmware_version` (real) contra `target_firmware_release_id` (deseado) para mostrar "al día" o "actualización pendiente", sin tener que interpretar el historial de `commands`.

Aplicar a "toda la organización" es una operación de la aplicación (fan-out sobre las unidades activas tipo `totem` de esa organización), no un concepto nuevo en el schema — evita introducir una tabla de "scope" (unit vs. organization) que solo serviría para reconstruir algo que ya es derivable iterando `units`.

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

Análogamente, `totem_configs` solo debe crearse para unidades con `type = 'totem'`, y `supply_tank_configs` solo para unidades con `type = 'supply_tank'`. Tampoco expresable con FK — la aplicación lo garantiza.

El mismo patrón aplica a `units.target_firmware_release_id → firmware_releases`: la aplicación debe verificar que `firmware_releases.organization_id = units.organization_id` antes de asignar un release como objetivo de una unidad. Este check debe ejecutarse en el endpoint que aplica firmware a una unidad o a toda la organización (ver `capa2/api-contract.md`).

El mismo patrón aplica también a `totem_configs.supply_tank_id → units`: la aplicación debe verificar (1) que la unidad referenciada tenga `type = 'supply_tank'` y (2) que pertenezca a la misma `organization_id` que el Totem, antes de asignarla. Ninguna de las dos reglas es expresable con CHECK/FK simple en PostgreSQL.

### Constraints añadidos en el SQL (ausentes en el diseño original)

| Tabla | Constraint | Valores válidos / regla |
|---|---|---|
| `memberships` | `CHECK (role IN (...))` | `admin`, `member` |
| `units` | `CHECK (type IN (...))` | `totem`, `supply_tank` |
| `device_events` | `CHECK (type IN (...))` | `pump_on`, `pump_off`, `valve_open`, `valve_close` |
| `device_events` | `CHECK (trigger IN (...))` | `autonomous`, `override` |
| `device_events` | `CHECK (duration_s IS NULL OR duration_s >= 0)` | Duración no negativa |
| `commands` | `CHECK (type IN (...))` | los siete tipos definidos |
| `alerts` | `CHECK (severity IN (...))` | `critical`, `warning` |
| `crop_profiles` | `CHECK (temp_min <= temp_max)` etc. | rangos coherentes para cada variable (solo cuando ambos extremos están presentes) |
| `firmware_releases` | `UNIQUE (organization_id, version)` | la misma cadena de versión puede repetirse entre organizaciones distintas, no dentro de la misma |
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
| `totem_configs.supply_tank_id → units` | SET NULL | Si el tanque padre se borra (o se revoca), el Totem queda sin tanque asignado (nullable) — no bloquea el borrado del tanque |
| `supply_tank_configs → units` | CASCADE | La config es parte de la unidad — muere con ella (mismo criterio que `totem_configs`) |
| `crop_profiles → organizations` | RESTRICT | No borrar una org que todavía tiene perfiles |
| `readings → units` | CASCADE | Las lecturas no tienen valor sin su unidad |
| `device_events → units` | CASCADE | Ídem |
| `commands → units` | CASCADE | Ídem |
| `commands → users` | RESTRICT | Auditoría — ver nota arriba |
| `alerts → units` | CASCADE | Ídem |
| `firmware_releases → organizations` | RESTRICT | No borrar una org que todavía tiene releases publicados |
| `units → firmware_releases` (`target_firmware_release_id`) | SET NULL | Si el release se borra, la unidad queda sin objetivo (nullable) |
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
| `idx_totem_configs_supply_tank_id` | `totem_configs` | Encontrar los totems que abastece un tanque padre dado |
| `idx_readings_unit_timestamp` | `readings` | Histórico y últimas lecturas por unidad |
| `idx_device_events_unit_timestamp` | `device_events` | Historial de eventos por unidad |
| `idx_commands_unit_created_at` | `commands` | Historial de comandos por unidad |
| `idx_commands_pending` | `commands` | Cola de reintento (WHERE delivered_at IS NULL) |
| `idx_alerts_unit_timestamp` | `alerts` | Historial de alertas por unidad |
| `idx_alerts_timestamp` | `alerts` | Vista global de alertas recientes |
| `idx_alerts_telegram_pending` | `alerts` | Cola de notificaciones Telegram pendientes |
| `idx_firmware_releases_organization_id` | `firmware_releases` | Listar releases de una org |
| `idx_units_target_firmware_release_id` | `units` | Encontrar unidades pendientes de actualizar a un release dado |
| `idx_refresh_tokens_user_id` | `refresh_tokens` | Logout de todas las sesiones de un usuario |

### TimescaleDB — chunk_time_interval

`readings` usa `chunk_time_interval = 7 days`. Con lecturas cada 1–5 minutos por unidad, un chunk semanal produce ~2 000–10 000 filas por unidad por chunk — tamaño manejable para compresión y queries. Si el sistema crece a cientos de unidades simultáneas, reducir a `1 day`.
