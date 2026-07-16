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
from models import (
    CropProfile, DeviceEvent, FirmwareRelease, MaintenanceWindow, Membership,
    Reading, TotemConfig, Unit, User,
)
from mqtt import mqtt_client

router = APIRouter(tags=["units"])


# ---------- Schemas ----------

class ReadingsSnapshot(BaseModel):
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    light: Optional[float] = None
    air_quality: Optional[float] = None
    methane: Optional[float] = None
    co2: Optional[float] = None
    timestamp: Optional[str] = None


class UnitStateOut(BaseModel):
    pump_state: Literal["off", "supplying", "on"] = "off"
    readings: Optional[ReadingsSnapshot] = None
    last_seen: Optional[str] = None


class UnitIn(BaseModel):
    organization_id: str
    type: Literal["totem", "supply_tank"]
    name: str


class MaintenanceWindowOut(BaseModel):
    id: str
    unit_id: str
    started_at: datetime
    started_by: str
    started_by_email: Optional[str] = None
    ended_at: Optional[datetime] = None
    ended_by: Optional[str] = None
    ended_by_email: Optional[str] = None
    note: Optional[str] = None

    model_config = {"from_attributes": True}


class MaintenanceStartIn(BaseModel):
    note: Optional[str] = None


class UnitOut(BaseModel):
    id: str
    organization_id: str
    type: str
    name: str
    is_active: bool
    firmware_version: Optional[str] = None
    target_firmware_release_id: Optional[str] = None
    last_seen: Optional[datetime] = None
    created_at: datetime
    active_profile_id: Optional[str] = None
    # Ventana de mantenimiento abierta, o None si la unidad opera normal. Es el
    # estado "en mantenimiento" — derivado, no un flag almacenado.
    maintenance: Optional[MaintenanceWindowOut] = None

    model_config = {"from_attributes": True}


class UnitCreatedOut(UnitOut):
    api_key: str


class UnitPatchIn(BaseModel):
    name: str


class ReadingOut(BaseModel):
    timestamp: datetime
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    light: Optional[float] = None
    air_quality: Optional[float] = None
    methane: Optional[float] = None
    co2: Optional[float] = None

    model_config = {"from_attributes": True}


class DeviceEventOut(BaseModel):
    id: str
    timestamp: datetime
    type: str
    trigger: str
    # Duración (s) del tramo que cierra el evento: pump_off = bombeo, valve_close
    # = llenado. None en aperturas (pump_on/valve_open) y en eventos previos a
    # firmware 1.4.2.
    duration_s: Optional[float] = None

    model_config = {"from_attributes": True}


# ---------- Helpers ----------

def _active_profile_id(unit: Unit, db: Session) -> Optional[str]:
    if unit.type != "totem":
        return None
    config = db.query(TotemConfig).filter(TotemConfig.unit_id == unit.id).first()
    return str(config.active_profile_id) if config and config.active_profile_id else None


def _window_to_out(window: MaintenanceWindow, db: Session) -> MaintenanceWindowOut:
    """Resuelve los emails de quien abrió y cerró la ventana — la UI muestra
    personas, no UUIDs."""
    emails = {
        str(u.id): u.email
        for u in db.query(User).filter(
            User.id.in_([i for i in (window.started_by, window.ended_by) if i])
        ).all()
    }
    return MaintenanceWindowOut(
        id=str(window.id),
        unit_id=str(window.unit_id),
        started_at=window.started_at,
        started_by=str(window.started_by),
        started_by_email=emails.get(str(window.started_by)),
        ended_at=window.ended_at,
        ended_by=str(window.ended_by) if window.ended_by else None,
        ended_by_email=emails.get(str(window.ended_by)) if window.ended_by else None,
        note=window.note,
    )


def _open_window(unit_id: str, db: Session) -> Optional[MaintenanceWindow]:
    return db.query(MaintenanceWindow).filter(
        MaintenanceWindow.unit_id == unit_id,
        MaintenanceWindow.ended_at.is_(None),
    ).first()


def _unit_to_out(unit: Unit, db: Session) -> UnitOut:
    window = _open_window(str(unit.id), db)
    return UnitOut(
        id=str(unit.id),
        organization_id=str(unit.organization_id),
        type=unit.type,
        name=unit.name,
        is_active=unit.is_active,
        firmware_version=unit.firmware_version,
        target_firmware_release_id=str(unit.target_firmware_release_id) if unit.target_firmware_release_id else None,
        last_seen=unit.last_seen,
        created_at=unit.created_at,
        active_profile_id=_active_profile_id(unit, db),
        maintenance=_window_to_out(window, db) if window else None,
    )


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
    return _unit_to_out(unit, db)


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
    return [_unit_to_out(u, db) for u in units]


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


@router.patch(
    "/units/{unit_id}",
    summary="Actualizar nombre de una unidad",
    description="""
**¿Qué hace?**
Modifica el nombre de la unidad indicada.

**¿Para qué?**
Permite al administrador corregir o personalizar el nombre de un dispositivo
sin darlo de baja ni alterar su configuración.

**¿Dónde se usa?**
Pantalla de gestión de unidades — acción de edición inline.
""",
    response_model=UnitOut,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "Solo los administradores pueden editar unidades"},
        404: {"description": "Unidad no encontrada"},
    },
    tags=["units"],
)
def patch_unit(
    unit_id: str,
    body: UnitPatchIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    unit = _require_unit_access(unit_id, current_user, db)

    membership = db.query(Membership).filter(
        Membership.user_id == current_user.id,
        Membership.organization_id == unit.organization_id,
    ).first()
    if not membership or membership.role != "admin":
        raise HTTPException(status_code=403, detail="Solo los administradores pueden editar unidades")

    unit.name = body.name
    db.commit()
    db.refresh(unit)
    return _unit_to_out(unit, db)


@router.post(
    "/units/{unit_id}/regenerate-key",
    summary="Regenerar la API key de una unidad",
    description="""
**¿Qué hace?**
Genera una nueva `api_key` para la unidad y descarta la anterior de inmediato.

**¿Para qué?**
Permite recuperar el acceso a una unidad cuando la `api_key` original se perdió
o se sospecha que se filtró, sin tener que dar de baja la unidad y crear una nueva.

**¿Dónde se usa?**
Vista de detalle de unidad — sección "API Key" en la pestaña de configuración.

> **Importante:** la `api_key` anterior deja de ser válida de inmediato — el dispositivo
> se desconectará del broker MQTT hasta que se reprovisione con la nueva clave.
> Al igual que en el registro, la clave nueva solo se muestra una vez.
""",
    response_model=UnitCreatedOut,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "Solo los administradores pueden regenerar la API key"},
        404: {"description": "Unidad no encontrada"},
    },
    tags=["units"],
)
def regenerate_unit_key(
    unit_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    unit = _require_unit_access(unit_id, current_user, db)

    membership = db.query(Membership).filter(
        Membership.user_id == current_user.id,
        Membership.organization_id == unit.organization_id,
    ).first()
    if not membership or membership.role != "admin":
        raise HTTPException(status_code=403, detail="Solo los administradores pueden regenerar la API key")

    unit.api_key = secrets.token_hex(32)
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
        active_profile_id=_active_profile_id(unit, db),
        api_key=unit.api_key,
    )


@router.delete(
    "/units/{unit_id}",
    summary="Desactivar una unidad (soft delete)",
    description="""
**¿Qué hace?**
Marca la unidad como inactiva (`is_active = false`). No elimina el registro ni
su historial de lecturas, eventos y alertas.

**¿Para qué?**
Revoca el acceso MQTT del dispositivo: en la próxima reconexión Mosquitto rechazará
la autenticación. El historial se preserva para consulta futura.
Para reactivar la unidad se requiere acceso directo a la base de datos.

**¿Dónde se usa?**
Pantalla de gestión de unidades — acción "Dar de baja".
""",
    status_code=204,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "Solo los administradores pueden desactivar unidades"},
        404: {"description": "Unidad no encontrada"},
    },
    tags=["units"],
)
def deactivate_unit(
    unit_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    unit = _require_unit_access(unit_id, current_user, db)

    membership = db.query(Membership).filter(
        Membership.user_id == current_user.id,
        Membership.organization_id == unit.organization_id,
    ).first()
    if not membership or membership.role != "admin":
        raise HTTPException(status_code=403, detail="Solo los administradores pueden desactivar unidades")

    unit.is_active = False
    db.commit()


@router.get(
    "/units/{unit_id}/readings",
    summary="Histórico de lecturas de sensores de una unidad",
    description="""
**¿Qué hace?**
Devuelve lecturas históricas de sensores (temperatura, humedad, luz, calidad de aire,
metano) para una unidad, ordenadas de más reciente a más antigua. Los campos que la
unidad no reporte llegan como `null`.

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
            duration_s=e.duration_s,
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
        409: {"description": "El perfil no pertenece a la misma organización que la unidad, o su irrigation_method no está soportado por el firmware objetivo de la unidad"},
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

    # Compatibilidad perfil ↔ firmware: si la unidad tiene un release objetivo
    # conocido, su binario debe declarar soporte para el método de riego del
    # perfil. Sin release objetivo (unidad recién creada, sin OTA todavía) no
    # hay nada que contradecir, así que no se bloquea.
    if unit.target_firmware_release_id:
        release = db.query(FirmwareRelease).filter(FirmwareRelease.id == unit.target_firmware_release_id).first()
        if release and profile.irrigation_method not in release.supported_irrigation_methods:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"El firmware objetivo de esta unidad (v{release.version}) no soporta "
                    f"el método de riego '{profile.irrigation_method}' de este perfil"
                ),
            )

    config = db.query(TotemConfig).filter(TotemConfig.unit_id == unit_id).first()
    if config:
        config.active_profile_id = body.profile_id
    else:
        db.add(TotemConfig(unit_id=unit_id, active_profile_id=body.profile_id))
    db.commit()

    # Publicar el perfil completo al topic MQTT de la unidad, retenido: si el
    # ESP32 no estaba conectado/suscrito en el instante exacto de publicar
    # (ej. reconectando tras un OTA), el broker le entrega este mensaje en
    # cuanto se suscriba — sin retain, ese perfil se perdería para siempre
    # (QoS 1 no reenvía a una sesión que nunca llegó a suscribirse).
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
            "irrigation_method": profile.irrigation_method,
            "irrigation_params": profile.irrigation_params,
        },
        retain=True,
    )

    return {"detail": "Perfil asignado"}


# ---------- Mantenimiento ----------
#
# El mantenimiento vive enteramente en la Capa 2: no se le ordena nada al
# firmware ni se toca la decisión de riego (la Capa 1 sigue siendo autónoma, ver
# CLAUDE.md). Es la seguridad física —desconectar la unidad— la que garantiza que
# no riegue ni mida; estos endpoints solo registran la ventana para que el
# dashboard lo refleje y para que el server descarte lo que la unidad publique
# si se quedó encendida (ver mqtt.py).


@router.post(
    "/units/{unit_id}/maintenance",
    summary="Poner una unidad en mantenimiento",
    description="""
**¿Qué hace?**
Abre una ventana de mantenimiento para la unidad, registrando quién la inició y cuándo.
Mientras la ventana está abierta el server **descarta** todas las lecturas, eventos y
alertas que publique la unidad en vez de persistirlos. Los reportes de versión de
firmware (`status`) sí se siguen procesando, para no perder el rastro de un OTA
aprovechado durante la intervención.

**¿Para qué?**
Permite intervenir físicamente una unidad sin contaminar el histórico con telemetría
de sensores manipulados, sin disparar alertas de Telegram por falsos positivos y sin
que aparezca como caída en el dashboard. La ventana queda registrada para explicar
después el hueco en la serie de datos.

**¿Dónde se usa?**
Vista de detalle de unidad — pestaña Configuración, tarjeta "Mantenimiento".

> **Nota:** poner una unidad en mantenimiento **no la detiene**. El firmware es
> autónomo y seguirá midiendo y regando si tiene corriente. Antes de intervenir la
> unidad hay que desconectarla físicamente.
""",
    response_model=MaintenanceWindowOut,
    response_description="La ventana de mantenimiento recién abierta",
    status_code=201,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "La unidad no pertenece a una organización del usuario"},
        404: {"description": "Unidad no encontrada"},
        409: {"description": "La unidad ya está en mantenimiento"},
    },
    tags=["units"],
)
def start_maintenance(
    unit_id: str,
    body: MaintenanceStartIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_unit_access(unit_id, current_user, db)

    # No se exige rol admin a propósito: quien interviene físicamente la unidad
    # suele ser un técnico de campo sin permisos de administración, y la acción
    # es reversible y no destructiva (a diferencia de dar de baja una unidad).
    if _open_window(unit_id, db):
        raise HTTPException(status_code=409, detail="La unidad ya está en mantenimiento")

    window = MaintenanceWindow(
        unit_id=uuid.UUID(unit_id),
        started_at=datetime.now(timezone.utc),
        started_by=current_user.id,
        note=body.note,
    )
    db.add(window)
    db.commit()
    db.refresh(window)
    return _window_to_out(window, db)


@router.delete(
    "/units/{unit_id}/maintenance",
    summary="Sacar una unidad de mantenimiento",
    description="""
**¿Qué hace?**
Cierra la ventana de mantenimiento abierta de la unidad, registrando quién la cerró y
cuándo. A partir de ese momento el server vuelve a persistir las lecturas, eventos y
alertas que publique la unidad.

**¿Para qué?**
Devuelve la unidad a operación normal una vez terminada la intervención física.

**¿Dónde se usa?**
Vista de detalle de unidad — pestaña Configuración, tarjeta "Mantenimiento".
""",
    response_model=MaintenanceWindowOut,
    response_description="La ventana de mantenimiento ya cerrada",
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "La unidad no pertenece a una organización del usuario"},
        404: {"description": "Unidad no encontrada, o la unidad no está en mantenimiento"},
    },
    tags=["units"],
)
def end_maintenance(
    unit_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_unit_access(unit_id, current_user, db)

    window = _open_window(unit_id, db)
    if not window:
        raise HTTPException(status_code=404, detail="La unidad no está en mantenimiento")

    window.ended_at = datetime.now(timezone.utc)
    window.ended_by = current_user.id
    db.commit()
    db.refresh(window)
    return _window_to_out(window, db)


@router.get(
    "/units/{unit_id}/maintenance",
    summary="Historial de mantenimientos de una unidad",
    description="""
**¿Qué hace?**
Devuelve las ventanas de mantenimiento de la unidad, de más reciente a más antigua.
La primera puede estar abierta (`ended_at` en `null`), lo que significa que la unidad
está en mantenimiento ahora mismo.

**¿Para qué?**
Permite auditar quién intervino la unidad y cuándo, y explicar los huecos en el
histórico de lecturas: un periodo sin datos que coincide con una ventana es
mantenimiento, no una caída del dispositivo.

**¿Dónde se usa?**
Vista de detalle de unidad — pestaña Configuración, tarjeta "Mantenimiento".

**Parámetros de filtrado:**

| Parámetro | Tipo | Default | Descripción |
|---|---|---|---|
| `limit` | int | 20 | Máximo de ventanas devueltas (1-100) |
""",
    response_model=list[MaintenanceWindowOut],
    response_description="Ventanas de mantenimiento, más reciente primero",
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "La unidad no pertenece a una organización del usuario"},
        404: {"description": "Unidad no encontrada"},
    },
    tags=["units"],
)
def list_maintenance(
    unit_id: str,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_unit_access(unit_id, current_user, db)

    windows = db.query(MaintenanceWindow).filter(
        MaintenanceWindow.unit_id == unit_id,
    ).order_by(MaintenanceWindow.started_at.desc()).limit(limit).all()

    return [_window_to_out(w, db) for w in windows]
