"""readings co2

Sensor de CO2 nuevo (fase de prueba, solo monitoreo — NO alimenta la decisión
de riego, que sigue siendo por VPD):
  - co2: Senseair S8 (NDIR) por UART/Modbus. A diferencia de air_quality/methane
    (conteo crudo del ADC), el S8 entrega ppm ya CALIBRADOS por el propio sensor.

Nota: esto reintroduce SOLO readings.co2, para monitoreo. NO revive
crop_profiles.co2_min/co2_max (los umbrales de decisión por CO2/Pn que se
eliminaron el 10 jul 2026, ver 7a1c4e9f2b6d_remove_co2). El riego no vuelve a
depender de CO2.

Columna nullable — NULL = "esta unidad no tiene el sensor" (tabla ancha, ver
docs/capa2/schema.md).

Revision ID: e5f9c2a7d1b3
Revises: c3e7a1f9b8d2
Create Date: 2026-07-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e5f9c2a7d1b3'
down_revision: Union[str, Sequence[str], None] = 'c3e7a1f9b8d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE readings ADD COLUMN co2 FLOAT")


def downgrade() -> None:
    op.execute("ALTER TABLE readings DROP COLUMN co2")
