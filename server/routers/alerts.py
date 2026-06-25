from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from db import get_db
from models import Alert, Membership, Unit, User

router = APIRouter(tags=["alerts"])


# ---------- Schemas ----------

class AlertOut(BaseModel):
    id: str
    unit_id: str
    timestamp: datetime
    type: str
    severity: str
    message: Optional[str] = None
    resolved_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ---------- Endpoints ----------

@router.get(
    "/alerts",
    summary="Listar alertas de las unidades del usuario",
    description="""
**¿Qué hace?**
Devuelve alertas generadas por los dispositivos, filtradas a las unidades que pertenecen
a organizaciones del usuario autenticado. Ordenadas de más reciente a más antigua.

**¿Para qué?**
Permite al operador ver el estado de salud del sistema: alertas activas (sin resolver)
y el historial de incidentes pasados.

**¿Dónde se usa?**
Panel de alertas global y sección de alertas en la vista de detalle de unidad.

**Parámetros de filtrado:**

| Parámetro | Tipo | Default | Descripción |
|---|---|---|---|
| `unit_id` | UUID | — | Filtrar por unidad específica. Si se omite, devuelve todas las unidades accesibles |
| `resolved` | bool | — | `true` = solo resueltas · `false` = solo activas · omitir = todas |
| `limit` | int (1–500) | 100 | Máximo de registros devueltos |
""",
    response_model=list[AlertOut],
    response_description="Alertas ordenadas de más reciente a más antigua",
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
    },
)
def list_alerts(
    unit_id: Optional[str] = Query(default=None),
    resolved: Optional[bool] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Subquery: IDs de unidades accesibles para este usuario
    accessible_unit_ids = (
        db.query(Unit.id)
        .join(Membership, Unit.organization_id == Membership.organization_id)
        .filter(Membership.user_id == current_user.id)
        .subquery()
    )

    query = db.query(Alert).filter(Alert.unit_id.in_(accessible_unit_ids))

    if unit_id is not None:
        query = query.filter(Alert.unit_id == unit_id)

    if resolved is True:
        query = query.filter(Alert.resolved_at.isnot(None))
    elif resolved is False:
        query = query.filter(Alert.resolved_at.is_(None))

    alerts = query.order_by(Alert.timestamp.desc()).limit(limit).all()

    return [
        AlertOut(
            id=str(a.id),
            unit_id=str(a.unit_id),
            timestamp=a.timestamp,
            type=a.type,
            severity=a.severity,
            message=a.message,
            resolved_at=a.resolved_at,
        )
        for a in alerts
    ]
