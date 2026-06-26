import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

import state
from auth import get_current_user
from db import get_db
from models import CropProfile, DeviceEvent, Membership, Reading, TotemConfig, Unit, User
from mqtt import mqtt_client

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


class ReadingOut(BaseModel):
    timestamp: datetime
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    light: Optional[float] = None
    co2: Optional[float] = None

    model_config = {"from_attributes": True}


class DeviceEventOut(BaseModel):
    id: str
    timestamp: datetime
    type: str
    trigger: str

    model_config = {"from_attributes": True}


# ---------- Helper ----------

def _require_unit_access(unit_id: str, current_user: User, db: Session) -> Unit:
    unit = db.query(Unit).filter(Unit.id == unit_id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Unidad no encontrada")
    membership = db.query(Membership).filter(
        Membership.user_id == current_user.id,
        Membership.organization_id == unit.organization_id,
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="No tienes acceso a esta unidad")
    return unit


# ---------- Endpoints ----------

@router.get(
    "/units/{unit_id}",
    summary="Obtener metadata de una unidad",
    description="""
**¿Qué hace?**
Devuelve la metadata persistida en base de datos de una unidad: identificadores,
tipo, nombre, estado de activación, versión de firmware, última vez vista y fecha
de creación. No incluye lecturas de sensores ni estado en tiempo real.

**¿Para qué?**
Permite al frontend mostrar la ficha de una unidad específica con sus datos de
configuración e identidad. A diferencia de `/units/{unit_id}/state`, este endpoint
consulta la DB y no depende de que el dispositivo haya publicado datos recientes.

**¿Dónde se usa?**
Vista de detalle de unidad — encabezado con información del dispositivo.
""",
    response_model=UnitOut,
    tags=["units"],
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "La unidad no pertenece a una organización del usuario"},
        404: {"description": "Unidad no encontrada"},
    },
)
def get_unit(
    unit_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    unit = _require_unit_access(unit_id, current_user, db)
    return UnitOut(
        id=str(unit.id),
        organization_id=str(unit.organization_id),
        type=unit.type,
        name=unit.name,
        is_active=unit.is_active,
        firmware_version=unit.firmware_version,
        last_seen=unit.last_seen,
        created_at=unit.created_at,
    )


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
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "La unidad no pertenece a una organización del usuario"},
        404: {"description": "Unidad sin datos recibidos aún (el dispositivo no ha publicado)"},
    },
)
def get_unit_state(
    unit_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_unit_access(unit_id, current_user, db)
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


@router.get(
    "/units/{unit_id}/readings",
    summary="Histórico de lecturas de sensores de una unidad",
    description="""
**¿Qué hace?**
Devuelve lecturas históricas de sensores (temperatura, humedad, luz, CO₂) para una unidad,
ordenadas de más reciente a más antigua.

**¿Para qué?**
Alimenta las gráficas temporales del dashboard. Con los defaults devuelve las últimas
24 horas, suficiente para mostrar tendencias del día.

**¿Dónde se usa?**
Vista de detalle de unidad — sección de gráficas históricas.

**Parámetros de filtrado:**

| Parámetro | Tipo | Default | Descripción |
|---|---|---|---|
| `from` | ISO 8601 UTC | 24 h atrás | Inicio del rango temporal |
| `to` | ISO 8601 UTC | ahora | Fin del rango temporal |
| `limit` | int (1–5000) | 500 | Máximo de registros devueltos |
""",
    response_model=list[ReadingOut],
    response_description="Lecturas ordenadas de más reciente a más antigua",
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "La unidad no pertenece a una organización del usuario"},
        404: {"description": "Unidad no encontrada"},
    },
    tags=["readings"],
)
def get_readings(
    unit_id: str,
    from_dt: Optional[datetime] = Query(default=None, alias="from"),
    to_dt: Optional[datetime] = Query(default=None, alias="to"),
    limit: int = Query(default=500, ge=1, le=5000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_unit_access(unit_id, current_user, db)

    now = datetime.now(timezone.utc)
    from_dt = from_dt or (now - timedelta(hours=24))
    to_dt = to_dt or now

    readings = (
        db.query(Reading)
        .filter(
            Reading.unit_id == unit_id,
            Reading.timestamp >= from_dt,
            Reading.timestamp <= to_dt,
        )
        .order_by(Reading.timestamp.desc())
        .limit(limit)
        .all()
    )
    return readings


@router.get(
    "/units/{unit_id}/events",
    summary="Histórico de eventos de actuadores de una unidad",
    description="""
**¿Qué hace?**
Devuelve el historial de eventos de actuadores (bomba y válvula) de una unidad,
ordenados de más reciente a más antiguo.

**¿Para qué?**
Permite auditar cuándo regó el sistema, con qué trigger (autónomo o manual) y
calcular la duración de cada ciclo emparejando eventos `pump_on` / `pump_off`.

**¿Dónde se usa?**
Vista de detalle de unidad — sección de historial de riego.

**Parámetros de filtrado:**

| Parámetro | Tipo | Default | Descripción |
|---|---|---|---|
| `from` | ISO 8601 UTC | 7 días atrás | Inicio del rango temporal |
| `to` | ISO 8601 UTC | ahora | Fin del rango temporal |
| `limit` | int (1–1000) | 200 | Máximo de registros devueltos |
""",
    response_model=list[DeviceEventOut],
    response_description="Eventos ordenados de más reciente a más antiguo",
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "La unidad no pertenece a una organización del usuario"},
        404: {"description": "Unidad no encontrada"},
    },
    tags=["events"],
)
def get_events(
    unit_id: str,
    from_dt: Optional[datetime] = Query(default=None, alias="from"),
    to_dt: Optional[datetime] = Query(default=None, alias="to"),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_unit_access(unit_id, current_user, db)

    now = datetime.now(timezone.utc)
    from_dt = from_dt or (now - timedelta(days=7))
    to_dt = to_dt or now

    events = (
        db.query(DeviceEvent)
        .filter(
            DeviceEvent.unit_id == unit_id,
            DeviceEvent.timestamp >= from_dt,
            DeviceEvent.timestamp <= to_dt,
        )
        .order_by(DeviceEvent.timestamp.desc())
        .limit(limit)
        .all()
    )
    return [
        DeviceEventOut(
            id=str(e.id),
            timestamp=e.timestamp,
            type=e.type,
            trigger=e.trigger,
        )
        for e in events
    ]


# ---------- Profile assignment ----------

class AssignProfileIn(BaseModel):
    profile_id: Optional[str] = None


@router.put(
    "/units/{unit_id}/profile",
    summary="Asignar o quitar el perfil activo de una unidad",
    description="""
**¿Qué hace?**
Actualiza el perfil de cultivo activo de una unidad totem. Si `profile_id` es `null`,
quita el perfil activo sin asignar uno nuevo. Si se asigna un perfil, verifica que
pertenezca a la misma organización que la unidad y publica el perfil completo al topic
MQTT de la unidad para que el dispositivo lo reciba.

**¿Para qué?**
Permite al operador cambiar la receta de cultivo activa de una unidad desde el dashboard
sin intervención física. El perfil publicado por MQTT es consumido por el firmware para
ajustar los parámetros de decisión de riego.

**¿Dónde se usa?**
Vista de detalle de unidad — sección "Perfil activo" en la pestaña En vivo.
""",
    responses={
        200: {"description": "Perfil asignado o quitado correctamente"},
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "La unidad no pertenece a una organización del usuario"},
        404: {"description": "Unidad o perfil no encontrado"},
        409: {"description": "El perfil no pertenece a la misma organización que la unidad"},
    },
    tags=["units"],
)
def assign_profile(
    unit_id: str,
    body: AssignProfileIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    unit = _require_unit_access(unit_id, current_user, db)

    if body.profile_id is None:
        config = db.query(TotemConfig).filter(TotemConfig.unit_id == unit_id).first()
        if config:
            config.active_profile_id = None
            db.commit()
        return {"detail": "Perfil quitado"}

    # Verificar que el perfil existe
    profile = db.query(CropProfile).filter(CropProfile.id == body.profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil no encontrado")

    # Verificar que el perfil pertenece a la misma org que la unidad
    if str(profile.organization_id) != str(unit.organization_id):
        raise HTTPException(
            status_code=409,
            detail="El perfil no pertenece a la misma organización que la unidad",
        )

    config = db.query(TotemConfig).filter(TotemConfig.unit_id == unit_id).first()
    if config:
        config.active_profile_id = body.profile_id
    else:
        db.add(TotemConfig(unit_id=unit_id, active_profile_id=body.profile_id))
    db.commit()

    # Publicar el perfil completo al topic MQTT de la unidad
    mqtt_client.publish(
        f"totem/{unit_id}/profile",
        {
            "id": str(profile.id),
            "organization_id": str(profile.organization_id),
            "name": profile.name,
            "species": profile.species,
            "temp_min": profile.temp_min,
            "temp_max": profile.temp_max,
            "humidity_min": profile.humidity_min,
            "humidity_max": profile.humidity_max,
            "light_min": profile.light_min,
            "light_max": profile.light_max,
            "co2_min": profile.co2_min,
            "co2_max": profile.co2_max,
            "irrigation_method": profile.irrigation_method,
            "irrigation_params": profile.irrigation_params,
        },
    )

    return {"detail": "Perfil asignado"}
