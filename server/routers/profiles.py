import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from db import get_db
from models import CropProfile, Membership, TotemConfig, Unit, User

router = APIRouter(tags=["profiles"])


# ---------- Schemas ----------

class CropProfileOut(BaseModel):
    id: str
    organization_id: str
    name: str
    species: Optional[str] = None
    temp_min: Optional[float] = None
    temp_max: Optional[float] = None
    humidity_min: Optional[float] = None
    humidity_max: Optional[float] = None
    light_min: Optional[float] = None
    light_max: Optional[float] = None
    co2_min: Optional[float] = None
    co2_max: Optional[float] = None
    irrigation_method: str
    irrigation_params: dict
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CropProfileIn(BaseModel):
    organization_id: str
    name: str
    species: Optional[str] = None
    temp_min: Optional[float] = None
    temp_max: Optional[float] = None
    humidity_min: Optional[float] = None
    humidity_max: Optional[float] = None
    light_min: Optional[float] = None
    light_max: Optional[float] = None
    co2_min: Optional[float] = None
    co2_max: Optional[float] = None
    irrigation_method: str
    irrigation_params: dict


# ---------- Helper ----------

def _require_org_membership(organization_id: str, current_user: User, db: Session) -> Membership:
    membership = db.query(Membership).filter(
        Membership.user_id == current_user.id,
        Membership.organization_id == organization_id,
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="No perteneces a esta organización")
    return membership


# ---------- Endpoints ----------

@router.get(
    "/profiles",
    summary="Listar perfiles de cultivo de una organización",
    description="""
**¿Qué hace?**
Devuelve todos los perfiles de cultivo que pertenecen a una organización,
con todos sus parámetros de sensores y configuración de riego.

**¿Para qué?**
Permite al frontend mostrar el listado de perfiles disponibles para
asignarlos a unidades totem de la organización.

**¿Dónde se usa?**
Página de gestión de perfiles de cultivo y selector de perfil en la vista de detalle de unidad.

**Parámetros de filtrado:**

| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `organization_id` | UUID | Sí | ID de la organización cuyos perfiles se listan |
""",
    response_model=list[CropProfileOut],
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "El usuario no pertenece a esta organización"},
    },
)
def list_profiles(
    organization_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_org_membership(organization_id, current_user, db)

    profiles = db.query(CropProfile).filter(CropProfile.organization_id == organization_id).all()
    return [
        CropProfileOut(
            id=str(p.id),
            organization_id=str(p.organization_id),
            name=p.name,
            species=p.species,
            temp_min=p.temp_min,
            temp_max=p.temp_max,
            humidity_min=p.humidity_min,
            humidity_max=p.humidity_max,
            light_min=p.light_min,
            light_max=p.light_max,
            co2_min=p.co2_min,
            co2_max=p.co2_max,
            irrigation_method=p.irrigation_method,
            irrigation_params=p.irrigation_params,
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p in profiles
    ]


@router.post(
    "/profiles",
    summary="Crear un perfil de cultivo",
    description="""
**¿Qué hace?**
Crea un nuevo perfil de cultivo en la organización indicada con los parámetros
de condiciones ambientales óptimas y configuración del método de riego.

**¿Para qué?**
Permite definir recetas de cultivo reutilizables que luego se asignan a unidades
totem individuales para guiar el sistema de riego autónomo.

**¿Dónde se usa?**
Página de gestión de perfiles de cultivo — formulario de creación.
""",
    response_model=CropProfileOut,
    status_code=201,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "El usuario no pertenece a esta organización"},
    },
)
def create_profile(
    body: CropProfileIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_org_membership(body.organization_id, current_user, db)

    now = datetime.now(timezone.utc)
    profile = CropProfile(
        id=uuid.uuid4(),
        organization_id=body.organization_id,
        name=body.name,
        species=body.species,
        temp_min=body.temp_min,
        temp_max=body.temp_max,
        humidity_min=body.humidity_min,
        humidity_max=body.humidity_max,
        light_min=body.light_min,
        light_max=body.light_max,
        co2_min=body.co2_min,
        co2_max=body.co2_max,
        irrigation_method=body.irrigation_method,
        irrigation_params=body.irrigation_params,
        created_at=now,
        updated_at=now,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)

    return CropProfileOut(
        id=str(profile.id),
        organization_id=str(profile.organization_id),
        name=profile.name,
        species=profile.species,
        temp_min=profile.temp_min,
        temp_max=profile.temp_max,
        humidity_min=profile.humidity_min,
        humidity_max=profile.humidity_max,
        light_min=profile.light_min,
        light_max=profile.light_max,
        co2_min=profile.co2_min,
        co2_max=profile.co2_max,
        irrigation_method=profile.irrigation_method,
        irrigation_params=profile.irrigation_params,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


@router.put(
    "/profiles/{profile_id}",
    summary="Actualizar un perfil de cultivo",
    description="""
**¿Qué hace?**
Actualiza todos los campos de un perfil de cultivo existente y registra
la fecha de modificación.

**¿Para qué?**
Permite ajustar los parámetros de una receta de cultivo sin tener que
eliminarla y volver a crearla — los cambios se propagan a las unidades
que tengan este perfil asignado en su próxima sincronización.

**¿Dónde se usa?**
Página de gestión de perfiles — acción "Editar" en cada perfil.
""",
    response_model=CropProfileOut,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "El usuario no pertenece a esta organización"},
        404: {"description": "Perfil no encontrado"},
    },
)
def update_profile(
    profile_id: str,
    body: CropProfileIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = db.query(CropProfile).filter(CropProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil no encontrado")

    _require_org_membership(str(profile.organization_id), current_user, db)

    profile.organization_id = body.organization_id
    profile.name = body.name
    profile.species = body.species
    profile.temp_min = body.temp_min
    profile.temp_max = body.temp_max
    profile.humidity_min = body.humidity_min
    profile.humidity_max = body.humidity_max
    profile.light_min = body.light_min
    profile.light_max = body.light_max
    profile.co2_min = body.co2_min
    profile.co2_max = body.co2_max
    profile.irrigation_method = body.irrigation_method
    profile.irrigation_params = body.irrigation_params
    profile.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(profile)

    return CropProfileOut(
        id=str(profile.id),
        organization_id=str(profile.organization_id),
        name=profile.name,
        species=profile.species,
        temp_min=profile.temp_min,
        temp_max=profile.temp_max,
        humidity_min=profile.humidity_min,
        humidity_max=profile.humidity_max,
        light_min=profile.light_min,
        light_max=profile.light_max,
        co2_min=profile.co2_min,
        co2_max=profile.co2_max,
        irrigation_method=profile.irrigation_method,
        irrigation_params=profile.irrigation_params,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


@router.delete(
    "/profiles/{profile_id}",
    summary="Eliminar un perfil de cultivo",
    description="""
**¿Qué hace?**
Elimina un perfil de cultivo si no está asignado como perfil activo en ninguna unidad.
Si alguna unidad lo tiene activo, devuelve 409 con los nombres de las unidades afectadas.

**¿Para qué?**
Permite limpiar perfiles obsoletos del catálogo de la organización.
La verificación de dependencias evita dejar unidades en un estado inconsistente.

**¿Dónde se usa?**
Página de gestión de perfiles — acción "Eliminar" en cada perfil.
""",
    response_model=None,
    status_code=204,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "El usuario no pertenece a esta organización"},
        404: {"description": "Perfil no encontrado"},
        409: {"description": "El perfil está asignado como activo en una o más unidades"},
    },
)
def delete_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = db.query(CropProfile).filter(CropProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil no encontrado")

    _require_org_membership(str(profile.organization_id), current_user, db)

    # Verificar si alguna unidad tiene este perfil asignado
    assigned = (
        db.query(TotemConfig, Unit)
        .join(Unit, TotemConfig.unit_id == Unit.id)
        .filter(TotemConfig.active_profile_id == profile_id)
        .all()
    )

    if assigned:
        unit_names = ", ".join(unit.name for _, unit in assigned)
        raise HTTPException(
            status_code=409,
            detail=f"El perfil está asignado a las unidades: {unit_names}. Quítalo de esas unidades antes de eliminarlo.",
        )

    db.delete(profile)
    db.commit()
