from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
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


@router.post(
    "/alerts/{alert_id}/resolve",
    summary="Resolver una alerta manualmente",
    description="""
**¿Qué hace?**
Marca la alerta indicada como resuelta, registrando la fecha y hora actual en `resolved_at`.
Si la alerta ya estaba resuelta, devuelve 200 sin modificarla.

**¿Para qué?**
Permite al operador cerrar alertas desde el dashboard sin esperar a que el dispositivo
las resuelva automáticamente — útil para alertas de sensores corregidas manualmente
o incidentes ya atendidos.

**¿Dónde se usa?**
Panel de alertas en la vista de detalle de unidad — botón "Resolver".
""",
    response_model=AlertOut,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "La alerta no pertenece a una organización del usuario"},
        404: {"description": "Alerta no encontrada"},
    },
)
def resolve_alert(
    alert_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta no encontrada")

    # Verificar que la unidad de la alerta pertenece a una org del usuario
    accessible = (
        db.query(Unit.id)
        .join(Membership, Unit.organization_id == Membership.organization_id)
        .filter(Membership.user_id == current_user.id, Unit.id == alert.unit_id)
        .first()
    )
    if not accessible:
        raise HTTPException(status_code=403, detail="No tienes acceso a esta alerta")

    if alert.resolved_at is None:
        alert.resolved_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(alert)

    return AlertOut(
        id=str(alert.id),
        unit_id=str(alert.unit_id),
        timestamp=alert.timestamp,
        type=alert.type,
        severity=alert.severity,
        message=alert.message,
        resolved_at=alert.resolved_at,
    )
