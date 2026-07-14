"""readings air_quality + methane

Dos sensores de gas nuevos (fase de prueba, solo monitoreo — no alimentan la
decisión de riego):
  - air_quality: Grove Air Quality Sensor v1.3 (índice genérico de calidad de
    aire, sensor resistivo no selectivo).
  - methane: MQ-4, salida analógica (AO). El módulo también tiene salida
    digital (DO) con umbral por potenciómetro, pero no se usa — el umbral se
    aplica en software sobre el valor analógico.

Ambas columnas guardan el conteo crudo del ADC (0-4095 @ 12 bits) sin
calibrar, igual criterio que `light` hoy: en esta fase se envía el valor tal
cual y la conversión a unidades reales queda para una versión posterior de
firmware. Ver docs/capa1/.../modulo-lectura-sensores.md.

Columnas nullable — NULL = "esta unidad no tiene ese sensor" (tabla ancha, ver
docs/capa2/schema.md).

Revision ID: c3e7a1f9b8d2
Revises: b2d5f8c1a9e4
Create Date: 2026-07-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c3e7a1f9b8d2'
down_revision: Union[str, Sequence[str], None] = 'b2d5f8c1a9e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE readings ADD COLUMN air_quality FLOAT")
    op.execute("ALTER TABLE readings ADD COLUMN methane FLOAT")


def downgrade() -> None:
    op.execute("ALTER TABLE readings DROP COLUMN methane")
    op.execute("ALTER TABLE readings DROP COLUMN air_quality")
