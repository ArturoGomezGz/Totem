from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from db import get_db
from models import Membership, Organization, User

router = APIRouter(tags=["organizations"])


# ---------- Schemas ----------

class OrganizationIn(BaseModel):
    name: str


class OrganizationOut(BaseModel):
    id: str
    name: str
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}


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
