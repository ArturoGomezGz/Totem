"""remove co2

Decisión del 10 jul 2026: el riego se decide por VPD (T, RH) con Li como
modulador de duración, no por estimación de Pn con ML. Se descarta el
sensor de CO₂ del diseño por carga operativa de calibración/deriva en
sensores NDIR de bajo costo (experiencia del profesor colaborador +
literatura revisada). Ver docs/capa1/totem-principal/sistema-decision/modulo-decision.md.

Elimina co2_min/co2_max de crop_profiles (y su CHECK constraint) y co2
de readings.

Revision ID: 7a1c4e9f2b6d
Revises: 306e2ee130d6
Create Date: 2026-07-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '7a1c4e9f2b6d'
down_revision: Union[str, Sequence[str], None] = '306e2ee130d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE crop_profiles DROP CONSTRAINT crop_profiles_co2_range")
    op.execute("ALTER TABLE crop_profiles DROP COLUMN co2_min")
    op.execute("ALTER TABLE crop_profiles DROP COLUMN co2_max")
    op.execute("ALTER TABLE readings DROP COLUMN co2")


def downgrade() -> None:
    op.execute("ALTER TABLE readings ADD COLUMN co2 FLOAT")
    op.execute("ALTER TABLE crop_profiles ADD COLUMN co2_min FLOAT")
    op.execute("ALTER TABLE crop_profiles ADD COLUMN co2_max FLOAT")
    op.execute("""
        ALTER TABLE crop_profiles ADD CONSTRAINT crop_profiles_co2_range
            CHECK (co2_min IS NULL OR co2_max IS NULL OR co2_min <= co2_max)
    """)
