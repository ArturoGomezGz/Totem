# Esquema de Base de Datos

TimescaleDB (extensión de PostgreSQL). Stack completo en `docs/stack.md`.

Las entidades están identificadas; los campos pendientes se marcan con 🔴.

---

## Tablas

### `users`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `email` | VARCHAR UNIQUE NOT NULL | |
| `password_hash` | VARCHAR NOT NULL | |
| `created_at` | TIMESTAMPTZ NOT NULL | |

### `units`

Cada unidad pertenece a un usuario.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → users | |
| `name` | VARCHAR NOT NULL | Nombre legible asignado por el usuario |
| `api_key` | VARCHAR UNIQUE NOT NULL | Autenticación del dispositivo |
| `firmware_version` | VARCHAR | Última versión reportada por el dispositivo |
| `last_seen` | TIMESTAMPTZ | Último ciclo de comunicación exitoso |
| `created_at` | TIMESTAMPTZ NOT NULL | |

### `readings` *(hypertable TimescaleDB)*

Tabla ancha — una columna por tipo de sensor. Agregar un sensor nuevo = `ALTER TABLE ADD COLUMN`.

| Campo | Tipo | Notas |
|---|---|---|
| `unit_id` | UUID FK → units | |
| `timestamp` | TIMESTAMPTZ NOT NULL | Timestamp de la lectura en el dispositivo |
| `temperature` | FLOAT | °C |
| `humidity` | FLOAT | % RH |
| `light` | FLOAT | PAR / PPFD (µmol/m²/s) |
| `co2` | FLOAT | ppm |

Clave primaria compuesta: `(unit_id, timestamp)`. Particionado automático por tiempo via TimescaleDB.

### `pump_events`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `unit_id` | UUID FK → units | |
| `timestamp` | TIMESTAMPTZ NOT NULL | |
| `action` | VARCHAR NOT NULL | `ON` o `OFF` |
| `duration_seconds` | INTEGER | Solo para `action = ON` |
| `trigger` | VARCHAR NOT NULL | `autonomous` o `override` |

### `crop_profiles`

Parametrizan el Módulo de Decisión de Riego.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `name` | VARCHAR NOT NULL | ej. "Albahaca — etapa vegetativa" |
| `species` | VARCHAR | |
| `pn_threshold` | FLOAT | 🔴 Unidad y escala pendientes (depende del modelo ML) |
| `temp_min` | FLOAT | °C — usado para alertas |
| `temp_max` | FLOAT | °C |
| `humidity_min` | FLOAT | % RH |
| `humidity_max` | FLOAT | % RH |
| `light_min` | FLOAT | PAR |
| `light_max` | FLOAT | PAR |
| `co2_min` | FLOAT | ppm |
| `co2_max` | FLOAT | ppm |
| `pump_duration_seconds` | INTEGER | 🔴 Placeholder — reemplazar cuando se defina la función Pn → duración |
| `created_at` | TIMESTAMPTZ NOT NULL | |

🔴 **Pendiente:** ¿perfiles globales o privados por usuario? Ver decisiones pendientes.

### `commands`

Cola de comandos pendientes por unidad. El ESP32 los consume en polling.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `unit_id` | UUID FK → units | |
| `type` | VARCHAR NOT NULL | `pump_on`, `pump_off`, `pause_autonomous`, `update_profile`, `valve_open`, `valve_close` |
| `payload` | JSONB | Parámetros del comando |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `consumed_at` | TIMESTAMPTZ | NULL = pendiente; valor = consumido |

### `alerts`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `unit_id` | UUID FK → units | |
| `timestamp` | TIMESTAMPTZ NOT NULL | |
| `type` | VARCHAR NOT NULL | `tank_low`, `sensor_disconnected`, `pump_failure` |
| `severity` | VARCHAR NOT NULL | `critical` o `warning` |
| `message` | TEXT | |
| `status` | VARCHAR NOT NULL | `pending`, `sent`, `acknowledged` |

---

## Relaciones

```
users
  └── units (1 usuario → N unidades)
        ├── readings       (1 unidad → N lecturas)
        ├── pump_events    (1 unidad → N eventos)
        ├── commands       (1 unidad → N comandos)
        └── alerts         (1 unidad → N alertas)

crop_profiles
  └── units (perfil activo por unidad)
```

---

## Decisiones pendientes

### Nivel de tanque — no se persiste en `readings`

El nivel del tanque se gestiona únicamente a través de alertas y control de la válvula. No existe columna `tank_level` en la tabla `readings`.

**Dos flotadores digitales** montados en el tanque a ~30% y ~90% de capacidad:

| flotador_alto (90%) | flotador_bajo (30%) | Estado | Acción del sistema |
|---|---|---|---|
| Sumergido | Sumergido | Lleno (> 90%) | Válvula cerrada, LED verde |
| En aire | Sumergido | Normal (30–90%) | Sin acción |
| En aire | En aire | Bajo (< 30%) | Válvula abierta, LED rojo, alerta Telegram |

Las lecturas de los flotadores no viajan en el payload de `/readings` — el ESP32 actúa localmente de forma inmediata y genera una alerta via `/alerts` solo cuando el flotador del 30% se activa.

### Visibilidad de `crop_profiles`: global vs. privado por usuario
- **Global:** cualquier usuario puede usar cualquier perfil. Sin `user_id` en la tabla.
- **Privado:** cada usuario gestiona los suyos. Requiere `user_id FK → users`.

### Función Pn → duración de ciclo
`pump_duration_seconds` es un placeholder. Cuando se defina la función real, este campo se reemplaza con los parámetros que requiera.
