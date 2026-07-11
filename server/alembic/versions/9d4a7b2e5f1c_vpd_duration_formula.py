"""vpd_threshold: duración calculada con f(VPD) x g(Li)

Decisión del 11 jul 2026 (docs/capa1/totem-principal/sistema-decision/
modulo-decision.md § "Duración del ciclo"): la duración de riego para
vpd_threshold deja de ser un valor fijo (cycle_duration_s, igual que
fixed_timer) y pasa a calcularse como base_duration_s x f(VPD) x g(Li),
reutilizando threshold_vpd_kpa y light_min/light_max que el perfil ya
define — sin parámetros nuevos en el formulario.

Actualiza el params_schema del método en el catálogo y renombra la clave
cycle_duration_s -> base_duration_s en cualquier crop_profiles.irrigation_params
existente que use vpd_threshold.

Revision ID: 9d4a7b2e5f1c
Revises: 3f8b6d1a4c2e
Create Date: 2026-07-11 00:00:00.000000

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9d4a7b2e5f1c'
down_revision: Union[str, Sequence[str], None] = '3f8b6d1a4c2e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


NEW_VPD_SCHEMA = {
    "type": "object",
    "required": ["threshold_vpd_kpa", "base_duration_s", "min_interval_s"],
    "properties": {
        "threshold_vpd_kpa": {"type": "number", "exclusiveMinimum": 0},
        "base_duration_s": {"type": "number", "exclusiveMinimum": 0},
        "min_interval_s": {"type": "number", "minimum": 0},
    },
    "additionalProperties": False,
}

OLD_VPD_SCHEMA = {
    "type": "object",
    "required": ["threshold_vpd_kpa", "cycle_duration_s", "min_interval_s"],
    "properties": {
        "threshold_vpd_kpa": {"type": "number", "exclusiveMinimum": 0},
        "cycle_duration_s": {"type": "number", "exclusiveMinimum": 0},
        "min_interval_s": {"type": "number", "minimum": 0},
    },
    "additionalProperties": False,
}

NEW_DESCRIPTION = (
    "Riega cuando el Déficit de Presión de Vapor (T, RH) alcanza el umbral del perfil. "
    "La duración escala con VPD y con la luz respecto al rango ideal del perfil "
    "(base_duration_s x f(VPD) x g(Li)). Ver "
    "docs/capa1/totem-principal/sistema-decision/modulo-decision.md."
)


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text("""
            UPDATE irrigation_methods
            SET params_schema = :schema, description = :description
            WHERE key = 'vpd_threshold'
        """),
        {"schema": json.dumps(NEW_VPD_SCHEMA), "description": NEW_DESCRIPTION},
    )

    # Perfiles existentes con la forma antigua: renombrar la clave dentro del
    # JSONB sin tocar el resto de irrigation_params.
    conn.execute(sa.text("""
        UPDATE crop_profiles
        SET irrigation_params = (irrigation_params - 'cycle_duration_s')
            || jsonb_build_object('base_duration_s', irrigation_params->'cycle_duration_s')
        WHERE irrigation_method = 'vpd_threshold'
          AND irrigation_params ? 'cycle_duration_s'
    """))


def downgrade() -> None:
    conn = op.get_bind()

    conn.execute(sa.text("""
        UPDATE crop_profiles
        SET irrigation_params = (irrigation_params - 'base_duration_s')
            || jsonb_build_object('cycle_duration_s', irrigation_params->'base_duration_s')
        WHERE irrigation_method = 'vpd_threshold'
          AND irrigation_params ? 'base_duration_s'
    """))

    conn.execute(
        sa.text("""
            UPDATE irrigation_methods
            SET params_schema = :schema,
                description = 'Riega cuando el Déficit de Presión de Vapor (T, RH) alcanza el umbral del perfil.'
            WHERE key = 'vpd_threshold'
        """),
        {"schema": json.dumps(OLD_VPD_SCHEMA)},
    )
