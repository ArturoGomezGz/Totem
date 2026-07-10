"""irrigation methods catalog + firmware capability

Cierra el diseño del Perfil de Cultivo Activo como "conjunto de instrucciones
para el firmware", no solo rangos: introduce un catálogo formal de métodos
de riego (irrigation_methods) con un JSON Schema por método que valida la
forma de crop_profiles.irrigation_params, y una columna en firmware_releases
que declara qué métodos soporta cada binario compilado.

Ver docs/capa1/totem-principal/sistema-decision/modulo-decision.md y la
discusión de arquitectura sobre por qué un firmware puede soportar más de
un método (cuando comparten los mismos sensores).

Revision ID: 3f8b6d1a4c2e
Revises: 7a1c4e9f2b6d
Create Date: 2026-07-10 00:00:00.000000

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3f8b6d1a4c2e'
down_revision: Union[str, Sequence[str], None] = '7a1c4e9f2b6d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


FIXED_TIMER_SCHEMA = {
    "type": "object",
    "required": ["cycle_duration_s", "min_interval_s"],
    "properties": {
        "cycle_duration_s": {"type": "number", "exclusiveMinimum": 0},
        "min_interval_s": {"type": "number", "minimum": 0},
    },
    "additionalProperties": False,
}

VPD_THRESHOLD_SCHEMA = {
    "type": "object",
    "required": ["threshold_vpd_kpa", "cycle_duration_s", "min_interval_s"],
    "properties": {
        "threshold_vpd_kpa": {"type": "number", "exclusiveMinimum": 0},
        "cycle_duration_s": {"type": "number", "exclusiveMinimum": 0},
        "min_interval_s": {"type": "number", "minimum": 0},
    },
    "additionalProperties": False,
}


def upgrade() -> None:
    op.execute("""
        CREATE TABLE irrigation_methods (
            key            VARCHAR     PRIMARY KEY,
            name           VARCHAR     NOT NULL,
            description    TEXT,
            params_schema  JSONB       NOT NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT irrigation_methods_key_not_empty CHECK (key <> '')
        )
    """)

    conn = op.get_bind()
    conn.execute(
        sa.text("""
            INSERT INTO irrigation_methods (key, name, description, params_schema)
            VALUES (:key, :name, :description, :params_schema)
        """),
        [
            {
                "key": "fixed_timer",
                "name": "Timer fijo",
                "description": "Riega a intervalos y duración constantes, sin retroalimentación ambiental.",
                "params_schema": json.dumps(FIXED_TIMER_SCHEMA),
            },
            {
                "key": "vpd_threshold",
                "name": "Umbral de VPD",
                "description": (
                    "Riega cuando el Déficit de Presión de Vapor (T, RH) alcanza el umbral del perfil. "
                    "Ver docs/capa1/totem-principal/sistema-decision/modulo-decision.md."
                ),
                "params_schema": json.dumps(VPD_THRESHOLD_SCHEMA),
            },
        ],
    )

    # crop_profiles.irrigation_method pasa de VARCHAR libre a FK del catálogo.
    op.execute("""
        ALTER TABLE crop_profiles
            ADD CONSTRAINT crop_profiles_irrigation_method_fkey
            FOREIGN KEY (irrigation_method) REFERENCES irrigation_methods(key)
            ON DELETE RESTRICT ON UPDATE CASCADE
    """)

    # Qué métodos implementa cada binario compilado — declarado por el admin
    # al subir el release (ver routers/firmware.py). Sin FK a nivel de
    # elemento del array: Postgres no valida contenidos de JSONB contra otra
    # tabla, el API valida cada key contra el catálogo al escribir.
    op.execute("""
        ALTER TABLE firmware_releases
            ADD COLUMN supported_irrigation_methods JSONB NOT NULL DEFAULT '[]'
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE firmware_releases DROP COLUMN supported_irrigation_methods")
    op.execute("ALTER TABLE crop_profiles DROP CONSTRAINT crop_profiles_irrigation_method_fkey")
    op.execute("DROP TABLE irrigation_methods")
