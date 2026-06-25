import secrets
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import state
from auth import get_current_user
from db import get_db
from models import Membership, TotemConfig, Unit, User

router = APIRouter(tags=["units"])


# ---------- Schemas ----------

class ReadingsSnapshot(BaseModel):
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    light: Optional[float] = None
    co2: Optional[float] = None
    timestamp: Optional[str] = None


class UnitStateOut(BaseModel):
    pump_on: bool
    readings: Optional[ReadingsSnapshot] = None
    last_seen: Optional[str] = None


class UnitIn(BaseModel):
    organization_id: str
    type: Literal["totem", "supply_tank"]
    name: str


class UnitOut(BaseModel):
    id: str
    organization_id: str
    type: str
    name: str
    is_active: bool
    firmware_version: Optional[str] = None
    last_seen: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UnitCreatedOut(UnitOut):
    api_key: str


# ---------- Endpoints ----------

@router.get(
    "/units/{unit_id}/state",
    summary="Obtener estado en tiempo real de una unidad",
    description="""
**¿Qué hace?**
Devuelve el snapshot en memoria del estado más reciente de la unidad: última lectura de
sensores recibida vía MQTT y estado actual de la bomba.

**¿Para qué?**
Permite al frontend mostrar valores en vivo sin consultar la base de datos histórica.
Los datos se actualizan cada vez que el dispositivo publica una nueva lectura.

**¿Dónde se usa?**
Vista de detalle de unidad — panel de estado en tiempo real.

> **Nota:** este endpoint devuelve datos desde memoria volátil del servidor.
> Si el servidor se reinicia, el estado se pierde hasta que el dispositivo publique
> una nueva lectura. Para datos persistentes usar `GET /units/{unit_id}/readings`.
""",
    response_model=UnitStateOut,
    response_description="Último estado conocido de la unidad",
    responses={
        404: {"description": "Unidad sin datos recibidos aún (el dispositivo no ha publicado)"},
    },
)
def get_unit_state(unit_id: str):
    data = state.get_unit(unit_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Unidad no encontrada o sin datos aun")
    return data


@router.get(
    "/units",
    summary="Listar unidades de una organización",
    description="""
**¿Qué hace?**
Devuelve todas las unidades (totems y tanques) que pertenecen a una organización.

**¿Para qué?**
Permite al frontend mostrar el listado de dispositivos disponibles una vez que
el usuario ha seleccionado una organización.

**¿Dónde se usa?**
Pantalla principal de la organización — listado de unidades.

**Parámetros de filtrado:**

| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `organization_id` | UUID | Sí | ID de la organización cuyas unidades se listan |
""",
    response_model=list[UnitOut],
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "El usuario no pertenece a esta organización"},
    },
)
def list_units(
    organization_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = db.query(Membership).filter(
        Membership.user_id == current_user.id,
        Membership.organization_id == organization_id,
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="No perteneces a esta organización")

    units = db.query(Unit).filter(Unit.organization_id == organization_id).all()
    return [
        UnitOut(
            id=str(u.id),
            organization_id=str(u.organization_id),
            type=u.type,
            name=u.name,
            is_active=u.is_active,
            firmware_version=u.firmware_version,
            last_seen=u.last_seen,
            created_at=u.created_at,
        )
        for u in units
    ]


@router.post(
    "/units",
    summary="Registrar una unidad nueva",
    description="""
**¿Qué hace?**
Crea una unidad nueva en la organización indicada, genera su `api_key` para autenticación
MQTT y, si el tipo es `totem`, crea su entrada en `totem_configs`.

**¿Para qué?**
Alta de un dispositivo físico (ESP32) en el sistema. La `api_key` devuelta debe
flashearse en el dispositivo — es la única vez que se muestra en claro.

**¿Dónde se usa?**
Pantalla de gestión de unidades — acción "Agregar dispositivo".

> **Importante:** guarda la `api_key` mostrada. No se puede recuperar después,
> solo revocar y regenerar dando de baja la unidad.
""",
    response_model=UnitCreatedOut,
    status_code=201,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "Solo los administradores pueden registrar unidades"},
    },
)
def create_unit(
    body: UnitIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = db.query(Membership).filter(
        Membership.user_id == current_user.id,
        Membership.organization_id == body.organization_id,
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="No perteneces a esta organización")
    if membership.role != "admin":
        raise HTTPException(status_code=403, detail="Solo los administradores pueden registrar unidades")

    api_key = secrets.token_hex(32)
    now = datetime.now(timezone.utc)

    unit = Unit(
        id=uuid.uuid4(),
        organization_id=body.organization_id,
        type=body.type,
        name=body.name,
        api_key=api_key,
        is_active=True,
        created_at=now,
    )
    db.add(unit)
    db.flush()

    if body.type == "totem":
        db.add(TotemConfig(unit_id=unit.id, active_profile_id=None))

    db.commit()
    db.refresh(unit)

    return UnitCreatedOut(
        id=str(unit.id),
        organization_id=str(unit.organization_id),
        type=unit.type,
        name=unit.name,
        is_active=unit.is_active,
        firmware_version=unit.firmware_version,
        last_seen=unit.last_seen,
        created_at=unit.created_at,
        api_key=api_key,
    )
