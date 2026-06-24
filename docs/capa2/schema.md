# Esquema de Base de Datos

TimescaleDB (extensión de PostgreSQL). Stack completo en `docs/capa2/stack.md`.

**Estado:** cerrado · 24 jun 2026

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
| `api_key` | VARCHAR UNIQUE NOT NULL | Autenticación del dispositivo ante el broker MQTT |
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

---

## Relaciones

```
users
  └── memberships (rol: admin | member)
        └── organizations
              └── units (genérico: totem, supply_tank, etc.)
                    ├── totem_configs  (1:1, solo type = totem)
                    ├── readings       (1 unidad → N lecturas)
                    ├── device_events  (1 unidad → N eventos de actuadores)
                    ├── commands       (1 unidad → N comandos, issued_by → users)
                    └── alerts         (1 unidad → N alertas)

crop_profiles (privados por organización)
  └── totem_configs (perfil activo por totem)
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
