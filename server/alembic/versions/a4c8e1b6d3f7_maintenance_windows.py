"""maintenance_windows — ventanas de mantenimiento por unidad

Registra los periodos en que una unidad está intervenida por un técnico. Mientras
una ventana está abierta el server DESCARTA todo lo que publique la unidad
(lecturas, eventos y alertas) en vez de persistirlo — ver server/mqtt.py.

Se modela como ventanas (filas con inicio/fin y autor) y no como un flag en
`units` por dos razones:
  - El flag solo describe el ahora; la ventana explica el pasado. Un hueco en
    `readings` es indistinguible de una caída si no queda registro de que hubo
    mantenimiento — y esa distinción la necesitan tanto las métricas de
    disponibilidad (docs/evaluation-framework.md) como el futuro entrenamiento
    del modelo de Pn, que no debe leer un hueco de mantenimiento como un dato.
  - Deja traza de quién intervino qué unidad y cuándo.

El estado "en mantenimiento" es derivado: existe una fila con `ended_at IS NULL`.
No hay copia del estado en `units` — una sola fuente de verdad. El índice único
parcial hace que la DB, y no la aplicación, garantice que no puedan existir dos
ventanas abiertas para la misma unidad.

Revision ID: a4c8e1b6d3f7
Revises: e5f9c2a7d1b3
Create Date: 2026-07-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a4c8e1b6d3f7'
down_revision: Union[str, Sequence[str], None] = 'e5f9c2a7d1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE maintenance_windows (
            id          UUID PRIMARY KEY,
            unit_id     UUID NOT NULL REFERENCES units(id),
            started_at  TIMESTAMPTZ NOT NULL,
            started_by  UUID NOT NULL REFERENCES users(id),
            ended_at    TIMESTAMPTZ,
            ended_by    UUID REFERENCES users(id),
            note        TEXT,
            CONSTRAINT ck_maintenance_windows_order
                CHECK (ended_at IS NULL OR ended_at >= started_at),
            CONSTRAINT ck_maintenance_windows_ended_pair
                CHECK ((ended_at IS NULL) = (ended_by IS NULL))
        )
    """)

    # Una sola ventana abierta por unidad. El índice parcial cubre además el
    # query caliente: por cada mensaje MQTT se consulta si la unidad está en
    # mantenimiento (WHERE unit_id = ? AND ended_at IS NULL).
    op.execute("""
        CREATE UNIQUE INDEX ix_maintenance_windows_open_unit
            ON maintenance_windows (unit_id)
            WHERE ended_at IS NULL
    """)

    # Historial de una unidad, más reciente primero.
    op.execute("""
        CREATE INDEX ix_maintenance_windows_unit_started
            ON maintenance_windows (unit_id, started_at DESC)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE maintenance_windows")
