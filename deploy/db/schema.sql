-- =============================================================================
-- Totem — Schema SQL
-- TimescaleDB (PostgreSQL extension)
-- =============================================================================
-- Ejecutar contra una instancia limpia de TimescaleDB.
-- Requiere las extensiones uuid-ossp y timescaledb habilitadas (ver abajo).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensiones
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

CREATE TABLE users (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR     NOT NULL UNIQUE,
    password_hash VARCHAR     NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_email_not_empty CHECK (email <> '')
);

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

CREATE TABLE organizations (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       VARCHAR     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT organizations_name_not_empty CHECK (name <> '')
);

-- ---------------------------------------------------------------------------
-- memberships  (tabla pivote users ↔ organizations)
-- ---------------------------------------------------------------------------
-- Clave primaria compuesta: (user_id, organization_id).
-- Un usuario puede pertenecer a múltiples organizaciones con roles distintos.
-- ---------------------------------------------------------------------------

CREATE TABLE memberships (
    user_id         UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE  ON UPDATE CASCADE,
    organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE  ON UPDATE CASCADE,
    role            VARCHAR     NOT NULL,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, organization_id),

    -- Roles válidos: admin (acceso total) o member (solo lectura/monitoreo)
    CONSTRAINT memberships_role_valid CHECK (role IN ('admin', 'member'))
);

-- Acelera la búsqueda de todos los miembros de una organización
-- (operación frecuente: listar miembros, verificar pertenencia)
CREATE INDEX idx_memberships_organization_id ON memberships(organization_id);

-- ---------------------------------------------------------------------------
-- units
-- ---------------------------------------------------------------------------
-- Tabla base genérica para cualquier tipo de unidad del sistema.
-- Campos específicos por tipo viven en su propia tabla de configuración
-- (ej. totem_configs para type = 'totem').
-- ---------------------------------------------------------------------------
-- NOTA DE SEGURIDAD: api_key se almacena en texto plano porque Mosquitto
-- necesita comparar el valor exacto recibido del ESP32 contra la DB en cada
-- intento de conexión. Si en el futuro se migra a un hash, el plugin
-- mosquitto-go-auth debe actualizarse para hacer la comparación equivalente.
-- ---------------------------------------------------------------------------

CREATE TABLE units (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    type            VARCHAR     NOT NULL,
    name            VARCHAR     NOT NULL,
    api_key         VARCHAR     NOT NULL UNIQUE,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    firmware_version VARCHAR,
    last_seen       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT units_type_valid   CHECK (type IN ('totem', 'supply_tank')),
    CONSTRAINT units_name_not_empty CHECK (name <> ''),
    CONSTRAINT units_api_key_not_empty CHECK (api_key <> '')
);

-- Listar todas las unidades de una organización (endpoint GET /api/v1/units)
CREATE INDEX idx_units_organization_id ON units(organization_id);

-- Autenticación MQTT: FastAPI consulta por api_key en cada conexión de dispositivo.
-- Ya cubierto por el UNIQUE constraint (crea índice implícito), pero se documenta
-- explícitamente porque es el índice más crítico del sistema en producción.
-- CREATE INDEX idx_units_api_key ON units(api_key);  -- implícito por UNIQUE

-- ---------------------------------------------------------------------------
-- crop_profiles
-- ---------------------------------------------------------------------------
-- Privados por organización: ON DELETE RESTRICT evita borrar una organización
-- que todavía tiene perfiles activos asignados a unidades.
-- ---------------------------------------------------------------------------
-- NOTA: irrigation_params es JSONB libre — su estructura varía según
-- irrigation_method. No tiene schema fijo por diseño (agregar un método
-- nuevo no requiere cambios en el esquema).
-- ---------------------------------------------------------------------------

CREATE TABLE crop_profiles (
    id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    name               VARCHAR     NOT NULL,
    species            VARCHAR,

    -- Rangos ambientales nullable: NULL = variable no aplica para este cultivo
    temp_min           FLOAT,
    temp_max           FLOAT,
    humidity_min       FLOAT,
    humidity_max       FLOAT,
    light_min          FLOAT,
    light_max          FLOAT,
    co2_min            FLOAT,
    co2_max            FLOAT,

    irrigation_method  VARCHAR     NOT NULL,
    irrigation_params  JSONB       NOT NULL,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT crop_profiles_name_not_empty CHECK (name <> ''),
    CONSTRAINT crop_profiles_irrigation_method_not_empty CHECK (irrigation_method <> ''),
    -- Rangos coherentes: si ambos extremos están presentes, min <= max
    CONSTRAINT crop_profiles_temp_range     CHECK (temp_min IS NULL OR temp_max IS NULL OR temp_min <= temp_max),
    CONSTRAINT crop_profiles_humidity_range CHECK (humidity_min IS NULL OR humidity_max IS NULL OR humidity_min <= humidity_max),
    CONSTRAINT crop_profiles_light_range    CHECK (light_min IS NULL OR light_max IS NULL OR light_min <= light_max),
    CONSTRAINT crop_profiles_co2_range      CHECK (co2_min IS NULL OR co2_max IS NULL OR co2_min <= co2_max)
);

-- Listar perfiles disponibles de una organización (GET /api/v1/profiles)
CREATE INDEX idx_crop_profiles_organization_id ON crop_profiles(organization_id);

-- ---------------------------------------------------------------------------
-- totem_configs
-- ---------------------------------------------------------------------------
-- Extensión 1:1 de units para type = 'totem'.
-- unit_id es PK y FK a units: ON DELETE CASCADE elimina la config si se borra
-- la unidad.
-- ---------------------------------------------------------------------------
-- NOTA DE INTEGRIDAD ENTRE ORGANIZACIONES: active_profile_id referencia
-- crop_profiles sin restricción de que pertenezcan a la misma organización.
-- La aplicación (FastAPI) debe validar que el perfil seleccionado pertenezca
-- a la misma organización que la unidad antes de asignarlo. Esta regla no puede
-- expresarse con un FK simple porque involucra dos tablas distintas.
-- ---------------------------------------------------------------------------
-- NOTA: no existe CHECK (units.type = 'totem') porque los CHECK constraints
-- no pueden cruzar tablas en PostgreSQL. La aplicación garantiza que solo
-- se crea totem_configs para unidades de tipo 'totem'.
-- ---------------------------------------------------------------------------

CREATE TABLE totem_configs (
    unit_id           UUID PRIMARY KEY REFERENCES units(id) ON DELETE CASCADE ON UPDATE CASCADE,
    active_profile_id UUID REFERENCES crop_profiles(id) ON DELETE SET NULL ON UPDATE CASCADE
    -- Nullable: una unidad recién creada puede no tener perfil asignado aún
);

-- Índice inverso: encontrar todas las unidades que usan un perfil determinado
-- (útil para validar que un perfil puede borrarse o para cascading updates)
CREATE INDEX idx_totem_configs_active_profile_id ON totem_configs(active_profile_id)
    WHERE active_profile_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- readings  (hypertable TimescaleDB)
-- ---------------------------------------------------------------------------
-- Tabla ancha: una columna por tipo de sensor. Agregar un sensor nuevo =
-- ALTER TABLE ADD COLUMN (sin downtime en TimescaleDB).
-- Todas las columnas de sensores son nullable: NULL = sensor no instalado,
-- no fallo de lectura. Distintas configuraciones de hardware publican solo
-- las variables que miden.
-- ---------------------------------------------------------------------------
-- chunk_time_interval = 7 days: con lecturas cada 1–5 min por unidad,
-- un chunk semanal produce archivos de tamaño manejable. Si el número de
-- unidades crece a varios cientos, reducir a 1 day.
-- ---------------------------------------------------------------------------

CREATE TABLE readings (
    unit_id     UUID        NOT NULL REFERENCES units(id) ON DELETE CASCADE ON UPDATE CASCADE,
    timestamp   TIMESTAMPTZ NOT NULL,
    temperature FLOAT,      -- °C
    humidity    FLOAT,      -- % RH
    light       FLOAT,      -- PAR / PPFD (µmol/m²/s)
    co2         FLOAT,      -- ppm

    PRIMARY KEY (unit_id, timestamp)
);

SELECT create_hypertable(
    'readings',
    'timestamp',
    chunk_time_interval => INTERVAL '7 days'
);

-- TimescaleDB crea automáticamente un índice sobre timestamp al convertir la
-- tabla en hypertable. El índice compuesto (unit_id, timestamp DESC) cubre las
-- queries más frecuentes: últimas N lecturas de una unidad y rangos históricos.
CREATE INDEX idx_readings_unit_timestamp ON readings(unit_id, timestamp DESC);

-- ---------------------------------------------------------------------------
-- device_events
-- ---------------------------------------------------------------------------
-- Registro unificado de actuadores. Duración del ciclo de bomba = diferencia
-- entre el evento pump_off y su pump_on anterior para la misma unidad.
-- ---------------------------------------------------------------------------

CREATE TABLE device_events (
    id        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_id   UUID        NOT NULL REFERENCES units(id) ON DELETE CASCADE ON UPDATE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL,
    type      VARCHAR     NOT NULL,
    trigger   VARCHAR     NOT NULL,

    CONSTRAINT device_events_type_valid    CHECK (type    IN ('pump_on', 'pump_off', 'valve_open', 'valve_close')),
    CONSTRAINT device_events_trigger_valid CHECK (trigger IN ('autonomous', 'override'))
);

-- Histórico de eventos por unidad (GET /api/v1/units/{unit_id}/events)
CREATE INDEX idx_device_events_unit_timestamp ON device_events(unit_id, timestamp DESC);

-- ---------------------------------------------------------------------------
-- commands
-- ---------------------------------------------------------------------------
-- Historial de auditoría de comandos enviados desde el dashboard o bot.
-- La entrega es fire-and-forget (MQTT QoS 1 al broker).
-- delivered_at = NULL → publicación MQTT pendiente o fallida.
-- delivered_at = NOT NULL → el broker confirmó recepción del mensaje.
-- ---------------------------------------------------------------------------
-- issued_by: ON DELETE RESTRICT evita borrar un usuario que tenga comandos
-- en el historial (auditoría intacta). Si se requiere anonimizar usuarios,
-- la aplicación debe hacer SET NULL antes del DELETE.
-- ---------------------------------------------------------------------------

CREATE TABLE commands (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_id      UUID        NOT NULL REFERENCES units(id)  ON DELETE CASCADE  ON UPDATE CASCADE,
    issued_by    UUID        NOT NULL REFERENCES users(id)  ON DELETE RESTRICT ON UPDATE CASCADE,
    type         VARCHAR     NOT NULL,
    payload      JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,

    CONSTRAINT commands_type_valid CHECK (
        type IN ('pump_on', 'pump_off', 'pause_autonomous', 'update_profile', 'valve_open', 'valve_close', 'update_firmware')
    )
);

-- Historial de comandos por unidad (auditoría, dashboard)
CREATE INDEX idx_commands_unit_created_at ON commands(unit_id, created_at DESC);
-- Comandos pendientes de entrega (cola de reintento en la aplicación)
CREATE INDEX idx_commands_pending ON commands(unit_id, created_at DESC)
    WHERE delivered_at IS NULL;

-- ---------------------------------------------------------------------------
-- alerts
-- ---------------------------------------------------------------------------
-- type es VARCHAR libre sin enum: los valores cambian a medida que se agregan
-- condiciones de alerta sin requerir migraciones de schema.
-- resolved_at: el ESP32 publica resolución cuando la condición desaparece.
-- telegram_sent_at: NULL = notificación pendiente. Al arrancar el server
--   hace un sweep de alertas con telegram_sent_at IS NULL para reintentarlas.
-- ---------------------------------------------------------------------------

CREATE TABLE alerts (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_id          UUID        NOT NULL REFERENCES units(id) ON DELETE CASCADE ON UPDATE CASCADE,
    timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    type             VARCHAR     NOT NULL,
    severity         VARCHAR     NOT NULL,
    message          TEXT,
    resolved_at      TIMESTAMPTZ,
    telegram_sent_at TIMESTAMPTZ,

    CONSTRAINT alerts_severity_valid CHECK (severity IN ('critical', 'warning')),
    CONSTRAINT alerts_type_not_empty CHECK (type <> '')
);

-- Historial de alertas por unidad (GET /api/v1/alerts?unit_id=...)
CREATE INDEX idx_alerts_unit_timestamp ON alerts(unit_id, timestamp DESC);
-- Alertas recientes a nivel de organización (dashboard de alertas global)
CREATE INDEX idx_alerts_timestamp ON alerts(timestamp DESC);
-- Cola de notificaciones Telegram pendientes (sweep al arrancar el server)
CREATE INDEX idx_alerts_telegram_pending ON alerts(timestamp)
    WHERE telegram_sent_at IS NULL;

-- ---------------------------------------------------------------------------
-- refresh_tokens
-- ---------------------------------------------------------------------------
-- Permite invalidar sesiones individuales sin esperar a que expire el JWT.
-- Se almacena el hash del token — el valor en claro nunca toca la DB.
-- ---------------------------------------------------------------------------

CREATE TABLE refresh_tokens (
    token_hash VARCHAR     PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,

    CONSTRAINT refresh_tokens_token_not_empty CHECK (token_hash <> '')
);

-- Buscar todos los tokens activos de un usuario (ej. logout de todas las sesiones)
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- ---------------------------------------------------------------------------
-- firmware_releases
-- ---------------------------------------------------------------------------
-- Metadatos de versiones de firmware para OTA. Privada por organización:
-- cada organización compila y sube sus propios binarios, así que la misma
-- cadena de version puede repetirse entre organizaciones distintas.
-- El binario .bin vive en el filesystem del server (volumen Docker montado
-- en data/firmware/{organization_id}/). La DB guarda solo los metadatos.
-- ---------------------------------------------------------------------------
-- ON DELETE RESTRICT en organization_id: no se borra una org con releases
-- publicados. ON DELETE RESTRICT en uploaded_by: mismo criterio de auditoría
-- que commands.issued_by — no se pierde el registro de quién subió qué.
-- ---------------------------------------------------------------------------

CREATE TABLE firmware_releases (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    version         VARCHAR     NOT NULL,
    description     TEXT,
    binary_path     VARCHAR     NOT NULL,
    sha256          VARCHAR     NOT NULL,
    uploaded_by     UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    released_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT firmware_releases_version_not_empty     CHECK (version <> ''),
    CONSTRAINT firmware_releases_binary_path_not_empty CHECK (binary_path <> ''),
    CONSTRAINT firmware_releases_sha256_not_empty      CHECK (sha256 <> ''),
    CONSTRAINT firmware_releases_org_version_unique    UNIQUE (organization_id, version)
);

-- Listar releases de una organización (GET /api/v1/firmware?organization_id=...)
CREATE INDEX idx_firmware_releases_organization_id ON firmware_releases(organization_id);

-- ---------------------------------------------------------------------------
-- units.target_firmware_release_id
-- ---------------------------------------------------------------------------
-- Se agrega con ALTER porque firmware_releases se define después de units.
-- Versión "objetivo" que el admin quiere que la unidad ejecute — distinta de
-- units.firmware_version (lo que el dispositivo reporta tener instalado).
-- El dashboard compara ambas para mostrar "al día" / "actualización pendiente".
-- ON DELETE SET NULL: si el release se borra, la unidad queda sin objetivo.
-- ---------------------------------------------------------------------------

ALTER TABLE units ADD COLUMN target_firmware_release_id UUID
    REFERENCES firmware_releases(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX idx_units_target_firmware_release_id ON units(target_firmware_release_id)
    WHERE target_firmware_release_id IS NOT NULL;

-- telegram_users
-- ---------------------------------------------------------------------------
-- Vinculación entre usuarios de Totem y chats de Telegram.
-- Un usuario puede tener un solo chat vinculado a la vez.
-- ---------------------------------------------------------------------------

CREATE TABLE telegram_users (
    user_id   UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    chat_id   VARCHAR     NOT NULL UNIQUE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- telegram_link_tokens
-- ---------------------------------------------------------------------------
-- Tokens de un solo uso (TTL 5 min) para vincular la cuenta de Telegram.
-- Se generan desde el dashboard y se consumen vía /vincular en el bot.
-- ---------------------------------------------------------------------------

CREATE TABLE telegram_link_tokens (
    token      VARCHAR     PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,

    CONSTRAINT telegram_link_tokens_token_not_empty CHECK (token <> '')
);

-- =============================================================================
-- Seed: datos mínimos para desarrollo y testing
-- =============================================================================
-- Una organización de prueba, un usuario admin, dos unidades (sim-001, sim-002)
-- con sus api_keys y sus totem_configs vacíos listos para recibir un perfil.
-- =============================================================================

-- UUIDs fijos para reproducibilidad en desarrollo
-- (en producción los genera uuid_generate_v4() automáticamente)

DO $$
DECLARE
    v_org_id    UUID := '00000000-0000-0000-0000-000000000001';
    v_user_id   UUID := '00000000-0000-0000-0000-000000000010';
    v_unit1_id  UUID := '00000000-0000-0000-0000-000000000100';
    v_unit2_id  UUID := '00000000-0000-0000-0000-000000000101';
BEGIN

    -- Organización de prueba
    INSERT INTO organizations (id, name, created_at)
    VALUES (v_org_id, 'Organización de Prueba', NOW());

    -- Usuario admin de prueba
    -- IMPORTANTE: password_hash corresponde a la contraseña 'changeme'.
    -- Reemplazar con un hash real (bcrypt o argon2) antes de usar en producción.
    INSERT INTO users (id, email, password_hash, created_at)
    VALUES (
        v_user_id,
        'admin@totem.local',
        '$2b$12$REPLACE_WITH_REAL_BCRYPT_HASH_changeme_placeholder_xxxxx',
        NOW()
    );

    -- Membresía: usuario admin en la organización de prueba
    INSERT INTO memberships (user_id, organization_id, role, joined_at)
    VALUES (v_user_id, v_org_id, 'admin', NOW());

    -- Unidad sim-001 (simulador totem principal)
    INSERT INTO units (id, organization_id, type, name, api_key, is_active, created_at)
    VALUES (
        v_unit1_id,
        v_org_id,
        'totem',
        'Simulador Totem 001',
        'sim-001-api-key-dev-only-replace-in-production',
        true,
        NOW()
    );

    -- Unidad sim-002 (segundo simulador totem)
    INSERT INTO units (id, organization_id, type, name, api_key, is_active, created_at)
    VALUES (
        v_unit2_id,
        v_org_id,
        'totem',
        'Simulador Totem 002',
        'sim-002-api-key-dev-only-replace-in-production',
        true,
        NOW()
    );

    -- totem_configs para ambas unidades (sin perfil activo asignado aún)
    INSERT INTO totem_configs (unit_id, active_profile_id)
    VALUES (v_unit1_id, NULL);

    INSERT INTO totem_configs (unit_id, active_profile_id)
    VALUES (v_unit2_id, NULL);

END $$;
