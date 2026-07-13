"""device_events duration_s

Auditoría de riego: cada evento de cierre de actuador (pump_off, valve_close)
ahora trae la duración exacta del tramo que termina, medida por el firmware con
el reloj monótono del ESP32 (fuente autoritativa, robusta al buffer offline).
Ver firmware/genesis set_supply y docs/capa2/schema.md.

Columna nullable: los eventos de apertura (pump_on, valve_open) y los eventos
históricos previos a esta versión no tienen duración.

Revision ID: b2d5f8c1a9e4
Revises: 9d4a7b2e5f1c
Create Date: 2026-07-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b2d5f8c1a9e4'
down_revision: Union[str, Sequence[str], None] = '9d4a7b2e5f1c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE device_events ADD COLUMN duration_s FLOAT")
    op.execute("""
        ALTER TABLE device_events ADD CONSTRAINT device_events_duration_nonneg
            CHECK (duration_s IS NULL OR duration_s >= 0)
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE device_events DROP CONSTRAINT device_events_duration_nonneg")
    op.execute("ALTER TABLE device_events DROP COLUMN duration_s")
