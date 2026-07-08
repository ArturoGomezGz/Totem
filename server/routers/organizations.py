from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user, require_org_admin, require_org_membership
from db import get_db
from models import Membership, Organization, User

router = APIRouter(tags=["organizations"])

VALID_ROLES = {"admin", "member"}


# ---------- Schemas ----------

class OrganizationIn(BaseModel):
    name: str


class OrganizationOut(BaseModel):
    id: str
    name: str
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MemberOut(BaseModel):
    user_id: str
    email: str
    role: str
    joined_at: datetime

    model_config = {"from_attributes": True}


class MemberIn(BaseModel):
    email: str
    role: str = "member"


class MemberRoleIn(BaseModel):
    role: str


def _member_to_out(membership: Membership, user: User) -> MemberOut:
    return MemberOut(
        user_id=str(user.id),
        email=user.email,
        role=membership.role,
        joined_at=membership.joined_at,
    )


# ---------- Endpoints ----------

@router.post(
    "/organizations",
    summary="Crear una organización",
    description="""
**¿Qué hace?**
Crea una nueva organización y registra automáticamente al usuario autenticado
como `admin` de ella.

**¿Para qué?**
Una organización agrupa unidades (totems, tanques) y usuarios bajo una misma cuenta.
Es el contenedor principal del sistema.

**¿Dónde se usa?**
Flujo de onboarding post-registro, cuando el usuario crea su primera cuenta.
""",
    response_model=OrganizationOut,
    status_code=201,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
    },
)
def create_organization(
    body: OrganizationIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    org = Organization(name=body.name, created_at=now)
    db.add(org)
    db.flush()

    membership = Membership(
        user_id=current_user.id,
        organization_id=org.id,
        role="admin",
        joined_at=now,
    )
    db.add(membership)
    db.commit()
    db.refresh(org)

    return OrganizationOut(
        id=str(org.id),
        name=org.name,
        role="admin",
        created_at=org.created_at,
    )


@router.get(
    "/organizations",
    summary="Listar organizaciones del usuario",
    description="""
**¿Qué hace?**
Devuelve todas las organizaciones a las que pertenece el usuario autenticado,
junto con su rol en cada una (`admin` o `member`).

**¿Para qué?**
Permite al frontend mostrar las cuentas disponibles tras el login
para que el usuario seleccione en cuál trabajar.

**¿Dónde se usa?**
Pantalla de selección de organización (post-login).
""",
    response_model=list[OrganizationOut],
    response_description="Lista de organizaciones con el rol del usuario en cada una",
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
    },
)
def list_organizations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    memberships = (
        db.query(Membership, Organization)
        .join(Organization, Membership.organization_id == Organization.id)
        .filter(Membership.user_id == current_user.id)
        .all()
    )

    return [
        OrganizationOut(
            id=str(org.id),
            name=org.name,
            role=membership.role,
            created_at=org.created_at,
        )
        for membership, org in memberships
    ]


@router.patch(
    "/organizations/{organization_id}",
    summary="Renombrar una organización",
    description="""
**¿Qué hace?**
Actualiza el nombre de la organización.

**¿Para qué?**
Permite corregir o actualizar el nombre de la organización sin tener que
recrearla.

**¿Dónde se usa?**
Panel de configuración de la organización — campo "Nombre" editable.
""",
    response_model=OrganizationOut,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "Solo los administradores pueden renombrar la organización"},
    },
)
def update_organization(
    organization_id: str,
    body: OrganizationIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = require_org_admin(organization_id, current_user, db)

    org = db.query(Organization).filter(Organization.id == organization_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organización no encontrada")

    org.name = body.name
    db.commit()
    db.refresh(org)

    return OrganizationOut(
        id=str(org.id),
        name=org.name,
        role=membership.role,
        created_at=org.created_at,
    )


@router.get(
    "/organizations/{organization_id}/members",
    summary="Listar miembros de una organización",
    description="""
**¿Qué hace?**
Devuelve todos los usuarios que pertenecen a la organización indicada, junto
con su email y su rol (`admin` o `member`).

**¿Para qué?**
Permite ver quién tiene acceso a la organización y con qué nivel de permisos,
antes de agregar, promover o quitar a alguien.

**¿Dónde se usa?**
Panel de gestión de miembros de la organización.
""",
    response_model=list[MemberOut],
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "No perteneces a esta organización"},
    },
)
def list_members(
    organization_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_org_membership(organization_id, current_user, db)

    rows = (
        db.query(Membership, User)
        .join(User, Membership.user_id == User.id)
        .filter(Membership.organization_id == organization_id)
        .all()
    )
    return [_member_to_out(membership, user) for membership, user in rows]


@router.post(
    "/organizations/{organization_id}/members",
    summary="Agregar un miembro existente a la organización",
    description="""
**¿Qué hace?**
Agrega a la organización a un usuario que **ya tiene cuenta** en Totem,
identificado por su email, con el rol indicado (`admin` o `member`).

**¿Para qué?**
Es la única forma de que exista más de un usuario en una organización — sin
esto, solo quien creó la organización puede operarla. No envía correo ni
genera un link de invitación: el usuario agregado simplemente ve la
organización aparecer la próxima vez que liste sus organizaciones.

**¿Dónde se usa?**
Panel de gestión de miembros — acción "Agregar miembro".

> **Nota:** si el email no corresponde a ningún usuario registrado, el
> endpoint devuelve 404 — quien invita debe pedirle a la otra persona que
> se registre primero en Totem con ese email.
""",
    status_code=201,
    response_model=MemberOut,
    responses={
        400: {"description": "Rol inválido — debe ser 'admin' o 'member'"},
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "Solo los administradores pueden agregar miembros"},
        404: {"description": "No existe un usuario registrado con ese email"},
        409: {"description": "El usuario ya es miembro de esta organización"},
    },
)
def add_member(
    organization_id: str,
    body: MemberIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_org_admin(organization_id, current_user, db)

    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="El rol debe ser 'admin' o 'member'")

    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="No existe un usuario registrado con ese email")

    existing = db.query(Membership).filter(
        Membership.user_id == user.id,
        Membership.organization_id == organization_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="El usuario ya es miembro de esta organización")

    membership = Membership(
        user_id=user.id,
        organization_id=organization_id,
        role=body.role,
        joined_at=datetime.now(timezone.utc),
    )
    db.add(membership)
    db.commit()

    return _member_to_out(membership, user)


def _count_admins(organization_id: str, db: Session) -> int:
    return db.query(Membership).filter(
        Membership.organization_id == organization_id,
        Membership.role == "admin",
    ).count()


@router.patch(
    "/organizations/{organization_id}/members/{user_id}",
    summary="Cambiar el rol de un miembro",
    description="""
**¿Qué hace?**
Cambia el rol de un miembro existente entre `admin` y `member`.

**¿Para qué?**
Permite promover a un miembro a administrador (para que pueda gestionar
unidades y firmware) o degradarlo a miembro operativo.

**¿Dónde se usa?**
Panel de gestión de miembros — selector de rol junto a cada miembro.

> **Nota:** no se permite dejar a la organización sin ningún administrador —
> si el miembro que se está degradando es el último admin, el endpoint
> devuelve 400 en vez de aplicar el cambio.
""",
    response_model=MemberOut,
    responses={
        400: {"description": "Rol inválido, o dejaría a la organización sin ningún admin"},
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "Solo los administradores pueden cambiar roles"},
        404: {"description": "El usuario no es miembro de esta organización"},
    },
)
def update_member_role(
    organization_id: str,
    user_id: str,
    body: MemberRoleIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_org_admin(organization_id, current_user, db)

    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="El rol debe ser 'admin' o 'member'")

    membership = db.query(Membership).filter(
        Membership.user_id == user_id,
        Membership.organization_id == organization_id,
    ).first()
    if not membership:
        raise HTTPException(status_code=404, detail="El usuario no es miembro de esta organización")

    if membership.role == "admin" and body.role != "admin" and _count_admins(organization_id, db) <= 1:
        raise HTTPException(status_code=400, detail="No puedes quitar al último administrador de la organización")

    membership.role = body.role
    db.commit()

    user = db.query(User).filter(User.id == user_id).first()
    return _member_to_out(membership, user)


@router.delete(
    "/organizations/{organization_id}/members/{user_id}",
    summary="Quitar un miembro de la organización",
    description="""
**¿Qué hace?**
Elimina la membresía de un usuario en la organización — deja de tener acceso
a sus unidades, perfiles y firmware, pero su cuenta de Totem no se toca.

**¿Para qué?**
Revocar acceso cuando alguien deja de necesitar operar la organización.

**¿Dónde se usa?**
Panel de gestión de miembros — acción "Quitar" junto a cada miembro.

> **Nota:** igual que al cambiar de rol, no se permite quitar al último
> administrador de la organización — devuelve 400 en ese caso.
""",
    status_code=204,
    responses={
        400: {"description": "Dejaría a la organización sin ningún admin"},
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "Solo los administradores pueden quitar miembros"},
        404: {"description": "El usuario no es miembro de esta organización"},
    },
)
def remove_member(
    organization_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_org_admin(organization_id, current_user, db)

    membership = db.query(Membership).filter(
        Membership.user_id == user_id,
        Membership.organization_id == organization_id,
    ).first()
    if not membership:
        raise HTTPException(status_code=404, detail="El usuario no es miembro de esta organización")

    if membership.role == "admin" and _count_admins(organization_id, db) <= 1:
        raise HTTPException(status_code=400, detail="No puedes quitar al último administrador de la organización")

    db.delete(membership)
    db.commit()
