"""schema inicial

Migración base: crea el esquema completo tal como existía en
deploy/db/schema.sql (fuente original, ahora retirada). A partir de esta
revisión, todo cambio de esquema se hace con una nueva migración Alembic —
nunca editando SQL a mano contra la base. Ver docs/capa2/migraciones-alembic.md.

El seed de desarrollo (organización de prueba, usuario admin, unidades
sim-001/sim-002) NO forma parte de las migraciones: vive en
deploy/db/seed.dev.sql y se aplica de forma opcional (ver deploy/README.md).

Revision ID: 306e2ee130d6
Revises:
Create Date: 2026-07-02 14:21:57.272627

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '306e2ee130d6'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # Extensiones
    # -----------------------------------------------------------------------
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")

    # -----------------------------------------------------------------------
    # users
    # -----------------------------------------------------------------------
    op.execute("""
        CREATE TABLE users (
            id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
            email         VARCHAR     NOT NULL UNIQUE,
            password_hash VARCHAR     NOT NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT users_email_not_empty CHECK (email <> '')
        )
    """)

    # -----------------------------------------------------------------------
    # organizations
    # -----------------------------------------------------------------------
    op.execute("""
        CREATE TABLE organizations (
            id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
            name       VARCHAR     NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT organizations_name_not_empty CHECK (name <> '')
        )
    """)

    # -----------------------------------------------------------------------
    # memberships (tabla pivote users <-> organizations)
    # -----------------------------------------------------------------------
    op.execute("""
        CREATE TABLE memberships (
            user_id         UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE  ON UPDATE CASCADE,
            organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE  ON UPDATE CASCADE,
            role            VARCHAR     NOT NULL,
            joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            PRIMARY KEY (user_id, organization_id),

            CONSTRAINT memberships_role_valid CHECK (role IN ('admin', 'member'))
        )
    """)
    op.execute("CREATE INDEX idx_memberships_organization_id ON memberships(organization_id)")

    # -----------------------------------------------------------------------
    # units
    # -----------------------------------------------------------------------
    # api_key en texto plano: Mosquitto compara el valor exacto en cada
    # conexión (ver docs/capa2/schema.md).
    # -----------------------------------------------------------------------
    op.execute("""
        CREATE TABLE units (
            id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
            organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
            type             VARCHAR     NOT NULL,
            name             VARCHAR     NOT NULL,
            api_key          VARCHAR     NOT NULL UNIQUE,
            is_active        BOOLEAN     NOT NULL DEFAULT true,
            firmware_version VARCHAR,
            last_seen        TIMESTAMPTZ,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT units_type_valid        CHECK (type IN ('totem', 'supply_tank')),
            CONSTRAINT units_name_not_empty    CHECK (name <> ''),
            CONSTRAINT units_api_key_not_empty CHECK (api_key <> '')
        )
    """)
    op.execute("CREATE INDEX idx_units_organization_id ON units(organization_id)")

    # -----------------------------------------------------------------------
    # crop_profiles
    # -----------------------------------------------------------------------
    op.execute("""
        CREATE TABLE crop_profiles (
            id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
            organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
            name               VARCHAR     NOT NULL,
            species            VARCHAR,

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

            CONSTRAINT crop_profiles_name_not_empty              CHECK (name <> ''),
            CONSTRAINT crop_profiles_irrigation_method_not_empty CHECK (irrigation_method <> ''),
            CONSTRAINT crop_profiles_temp_range     CHECK (temp_min IS NULL OR temp_max IS NULL OR temp_min <= temp_max),
            CONSTRAINT crop_profiles_humidity_range CHECK (humidity_min IS NULL OR humidity_max IS NULL OR humidity_min <= humidity_max),
            CONSTRAINT crop_profiles_light_range    CHECK (light_min IS NULL OR light_max IS NULL OR light_min <= light_max),
            CONSTRAINT crop_profiles_co2_range      CHECK (co2_min IS NULL OR co2_max IS NULL OR co2_min <= co2_max)
        )
    """)
    op.execute("CREATE INDEX idx_crop_profiles_organization_id ON crop_profiles(organization_id)")

    # -----------------------------------------------------------------------
    # totem_configs (extensión 1:1 de units para type = 'totem')
    # -----------------------------------------------------------------------
    # La restricción "el perfil debe pertenecer a la misma organización que
    # la unidad" no es expresable con FK — la garantiza FastAPI.
    # -----------------------------------------------------------------------
    op.execute("""
        CREATE TABLE totem_configs (
            unit_id           UUID PRIMARY KEY REFERENCES units(id) ON DELETE CASCADE ON UPDATE CASCADE,
            active_profile_id UUID REFERENCES crop_profiles(id) ON DELETE SET NULL ON UPDATE CASCADE
        )
    """)
    op.execute("""
        CREATE INDEX idx_totem_configs_active_profile_id ON totem_configs(active_profile_id)
            WHERE active_profile_id IS NOT NULL
    """)

    # -----------------------------------------------------------------------
    # readings (hypertable TimescaleDB)
    # -----------------------------------------------------------------------
    op.execute("""
        CREATE TABLE readings (
            unit_id     UUID        NOT NULL REFERENCES units(id) ON DELETE CASCADE ON UPDATE CASCADE,
            timestamp   TIMESTAMPTZ NOT NULL,
            temperature FLOAT,
            humidity    FLOAT,
            light       FLOAT,
            co2         FLOAT,

            PRIMARY KEY (unit_id, timestamp)
        )
    """)
    op.execute("""
        SELECT create_hypertable(
            'readings',
            'timestamp',
            chunk_time_interval => INTERVAL '7 days'
        )
    """)
    op.execute("CREATE INDEX idx_readings_unit_timestamp ON readings(unit_id, timestamp DESC)")

    # -----------------------------------------------------------------------
    # device_events
    # -----------------------------------------------------------------------
    op.execute("""
        CREATE TABLE device_events (
            id        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
            unit_id   UUID        NOT NULL REFERENCES units(id) ON DELETE CASCADE ON UPDATE CASCADE,
            timestamp TIMESTAMPTZ NOT NULL,
            type      VARCHAR     NOT NULL,
            trigger   VARCHAR     NOT NULL,

            CONSTRAINT device_events_type_valid    CHECK (type    IN ('pump_on', 'pump_off', 'valve_open', 'valve_close')),
            CONSTRAINT device_events_trigger_valid CHECK (trigger IN ('autonomous', 'override'))
        )
    """)
    op.execute("CREATE INDEX idx_device_events_unit_timestamp ON device_events(unit_id, timestamp DESC)")

    # -----------------------------------------------------------------------
    # commands
    # -----------------------------------------------------------------------
    op.execute("""
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
        )
    """)
    op.execute("CREATE INDEX idx_commands_unit_created_at ON commands(unit_id, created_at DESC)")
    op.execute("""
        CREATE INDEX idx_commands_pending ON commands(unit_id, created_at DESC)
            WHERE delivered_at IS NULL
    """)

    # -----------------------------------------------------------------------
    # alerts
    # -----------------------------------------------------------------------
    op.execute("""
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
        )
    """)
    op.execute("CREATE INDEX idx_alerts_unit_timestamp ON alerts(unit_id, timestamp DESC)")
    op.execute("CREATE INDEX idx_alerts_timestamp ON alerts(timestamp DESC)")
    op.execute("""
        CREATE INDEX idx_alerts_telegram_pending ON alerts(timestamp)
            WHERE telegram_sent_at IS NULL
    """)

    # -----------------------------------------------------------------------
    # refresh_tokens
    # -----------------------------------------------------------------------
    op.execute("""
        CREATE TABLE refresh_tokens (
            token_hash VARCHAR     PRIMARY KEY,
            user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,

            CONSTRAINT refresh_tokens_token_not_empty CHECK (token_hash <> '')
        )
    """)
    op.execute("CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id)")

    # -----------------------------------------------------------------------
    # firmware_releases (privada por organización)
    # -----------------------------------------------------------------------
    op.execute("""
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
        )
    """)
    op.execute("CREATE INDEX idx_firmware_releases_organization_id ON firmware_releases(organization_id)")

    # units.target_firmware_release_id — versión objetivo vs. la reportada
    op.execute("""
        ALTER TABLE units ADD COLUMN target_firmware_release_id UUID
            REFERENCES firmware_releases(id) ON DELETE SET NULL ON UPDATE CASCADE
    """)
    op.execute("""
        CREATE INDEX idx_units_target_firmware_release_id ON units(target_firmware_release_id)
            WHERE target_firmware_release_id IS NOT NULL
    """)

    # -----------------------------------------------------------------------
    # telegram_users / telegram_link_tokens
    # -----------------------------------------------------------------------
    op.execute("""
        CREATE TABLE telegram_users (
            user_id   UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            chat_id   VARCHAR     NOT NULL UNIQUE,
            linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE TABLE telegram_link_tokens (
            token      VARCHAR     PRIMARY KEY,
            user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            used_at    TIMESTAMPTZ,

            CONSTRAINT telegram_link_tokens_token_not_empty CHECK (token <> '')
        )
    """)


def downgrade() -> None:
    # Orden inverso de dependencias FK
    op.execute("DROP TABLE IF EXISTS telegram_link_tokens")
    op.execute("DROP TABLE IF EXISTS telegram_users")
    op.execute("ALTER TABLE units DROP COLUMN IF EXISTS target_firmware_release_id")
    op.execute("DROP TABLE IF EXISTS firmware_releases")
    op.execute("DROP TABLE IF EXISTS refresh_tokens")
    op.execute("DROP TABLE IF EXISTS alerts")
    op.execute("DROP TABLE IF EXISTS commands")
    op.execute("DROP TABLE IF EXISTS device_events")
    op.execute("DROP TABLE IF EXISTS readings")
    op.execute("DROP TABLE IF EXISTS totem_configs")
    op.execute("DROP TABLE IF EXISTS crop_profiles")
    op.execute("DROP TABLE IF EXISTS units")
    op.execute("DROP TABLE IF EXISTS memberships")
    op.execute("DROP TABLE IF EXISTS organizations")
    op.execute("DROP TABLE IF EXISTS users")
