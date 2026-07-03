import hashlib
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user, require_org_admin, require_org_membership
from config import FIRMWARE_DIR, SERVER_URL
from db import get_db
from models import Command, FirmwareRelease, Unit, User
from mqtt import mqtt_client

router = APIRouter(tags=["firmware"])


# ---------- Schemas ----------

class FirmwareReleaseOut(BaseModel):
    id: str
    organization_id: str
    version: str
    description: Optional[str] = None
    sha256: str
    uploaded_by: str
    released_at: datetime
    download_url: str

    model_config = {"from_attributes": True}


class DeployIn(BaseModel):
    unit_id: Optional[str] = None
    organization_id: Optional[str] = None


# ---------- Helpers ----------

def _release_to_out(r: FirmwareRelease) -> FirmwareReleaseOut:
    return FirmwareReleaseOut(
        id=str(r.id),
        organization_id=str(r.organization_id),
        version=r.version,
        description=r.description,
        sha256=r.sha256,
        uploaded_by=str(r.uploaded_by),
        released_at=r.released_at,
        download_url=f"{SERVER_URL}/api/v1/firmware/{r.id}/binary",
    )


# ---------- Endpoints ----------

@router.get(
    "/firmware",
    summary="Listar versiones de firmware de una organización",
    description="""
**¿Qué hace?**
Devuelve todas las versiones de firmware publicadas por la organización indicada,
ordenadas de más reciente a más antigua.

**¿Para qué?**
Permite al administrador ver qué versiones están disponibles para desplegar via OTA
y consultar el hash SHA-256 de cada binario para verificación de integridad.

**¿Dónde se usa?**
Panel de gestión de firmware — listado de releases disponibles.

**Parámetros de filtrado:**

| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `organization_id` | UUID | Sí | ID de la organización cuyos releases se listan |
""",
    response_model=list[FirmwareReleaseOut],
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "El usuario no pertenece a esta organización"},
    },
)
def list_firmware(
    organization_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_org_membership(organization_id, current_user, db)

    releases = (
        db.query(FirmwareRelease)
        .filter(FirmwareRelease.organization_id == organization_id)
        .order_by(FirmwareRelease.released_at.desc())
        .all()
    )
    return [_release_to_out(r) for r in releases]


@router.post(
    "/firmware",
    summary="Publicar una versión de firmware",
    description="""
**¿Qué hace?**
Recibe un binario `.bin` compilado para ESP32, calcula su SHA-256, lo guarda en el
filesystem del servidor (bajo la carpeta de la organización) y registra el release
en la base de datos.

**¿Para qué?**
Alta de una nueva versión de firmware lista para desplegar via OTA a los dispositivos
de la organización. Solo los administradores de la organización pueden subir releases.

**¿Dónde se usa?**
Flujo de release de firmware — acción "Publicar versión" del panel de administración.

> **Nota:** `version` debe ser semántica (`1.2.0`). Es única dentro de la organización
> — otra organización puede publicar su propia versión `1.2.0` sin chocar. Si ya existe
> una versión con ese nombre en la misma organización, el endpoint devuelve 409 sin
> sobrescribir el binario existente.
""",
    response_model=FirmwareReleaseOut,
    status_code=201,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "Solo los administradores pueden publicar firmware"},
        409: {"description": "Ya existe un release con esa versión en esta organización"},
    },
)
async def upload_firmware(
    organization_id: str = Form(...),
    version: str = Form(...),
    description: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_org_admin(organization_id, current_user, db)

    existing = db.query(FirmwareRelease).filter(
        FirmwareRelease.organization_id == organization_id,
        FirmwareRelease.version == version,
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Ya existe un release para la versión {version} en esta organización",
        )

    content = await file.read()
    sha256 = hashlib.sha256(content).hexdigest()

    org_dir = os.path.join(FIRMWARE_DIR, organization_id)
    os.makedirs(org_dir, exist_ok=True)
    binary_path = os.path.join(org_dir, f"totem-{version}.bin")

    with open(binary_path, "wb") as f:
        f.write(content)

    release = FirmwareRelease(
        id=uuid.uuid4(),
        organization_id=organization_id,
        version=version,
        description=description,
        binary_path=binary_path,
        sha256=sha256,
        uploaded_by=current_user.id,
        released_at=datetime.now(timezone.utc),
    )
    db.add(release)
    db.commit()
    db.refresh(release)

    return _release_to_out(release)


@router.get(
    "/firmware/{firmware_release_id}/binary",
    summary="Descargar binario de una versión de firmware",
    description="""
**¿Qué hace?**
Sirve el archivo `.bin` del firmware correspondiente al release indicado
como descarga directa (`application/octet-stream`).

**¿Para qué?**
Endpoint que consume el ESP32 durante el proceso OTA: recibe la URL de descarga
via MQTT y hace un GET a este endpoint para obtener el binario.

**¿Dónde se usa?**
Llamado directamente por el firmware del ESP32 durante una actualización OTA.
No requiere autenticación — el dispositivo no tiene JWT.
""",
    responses={
        404: {"description": "Release de firmware no encontrado"},
    },
)
def download_firmware(
    firmware_release_id: str,
    db: Session = Depends(get_db),
):
    release = db.query(FirmwareRelease).filter(FirmwareRelease.id == firmware_release_id).first()
    if not release:
        raise HTTPException(status_code=404, detail="Release no encontrado")

    if not os.path.exists(release.binary_path):
        raise HTTPException(status_code=404, detail="Binario no encontrado en el servidor")

    return FileResponse(
        path=release.binary_path,
        media_type="application/octet-stream",
        filename=f"totem-{release.version}.bin",
    )


@router.post(
    "/firmware/{firmware_release_id}/deploy",
    summary="Aplicar un release de firmware a una unidad o a toda la organización",
    description="""
**¿Qué hace?**
Registra un comando `update_firmware` (tabla `commands`, auditable por
`issued_by`/`delivered_at`) por cada unidad afectada, publica la notificación OTA
al topic MQTT de esa unidad (`totem/{unit_id}/ota`) con versión, URL de descarga
y hash SHA-256, y actualiza `target_firmware_release_id` en la unidad.

**¿Para qué?**
Desencadena el proceso OTA en el dispositivo sin intervención física, dejando
un registro de qué versión se aplicó, cuándo y quién lo hizo. El dashboard puede
comparar `target_firmware_release_id` contra `firmware_version` (la reportada
por el dispositivo) para mostrar "al día" o "actualización pendiente".

**¿Dónde se usa?**
Panel de gestión de firmware — acción "Aplicar" sobre una versión publicada.

**Targeting:**
Exactamente uno de los dos campos debe estar presente:

| Campo | Efecto |
|---|---|
| `unit_id` | Aplica a una sola unidad |
| `organization_id` | Aplica a todas las unidades activas tipo `totem` de la organización |
""",
    responses={
        200: {"description": "Notificación publicada"},
        400: {"description": "Debe especificarse unit_id o organization_id (no ambos, no ninguno)"},
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "Solo los administradores pueden aplicar firmware"},
        404: {"description": "Release, unidad u organización no encontrada"},
    },
)
def deploy_firmware(
    firmware_release_id: str,
    body: DeployIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if bool(body.unit_id) == bool(body.organization_id):
        raise HTTPException(
            status_code=400,
            detail="Especifica exactamente uno: unit_id o organization_id",
        )

    release = db.query(FirmwareRelease).filter(FirmwareRelease.id == firmware_release_id).first()
    if not release:
        raise HTTPException(status_code=404, detail="Release no encontrado")

    payload = {
        "firmware_release_id": str(release.id),
        "version": release.version,
        "url": f"{SERVER_URL}/api/v1/firmware/{release.id}/binary",
        "sha256": release.sha256,
    }

    if body.unit_id:
        unit = db.query(Unit).filter(Unit.id == body.unit_id).first()
        if not unit:
            raise HTTPException(status_code=404, detail="Unidad no encontrada")
        if str(unit.organization_id) != str(release.organization_id):
            raise HTTPException(status_code=404, detail="El release no pertenece a la organización de esta unidad")

        require_org_admin(str(unit.organization_id), current_user, db)

        _deploy_to_unit(unit, release, payload, current_user, db)
        db.commit()
        return {"detail": f"Firmware {release.version} aplicado a unidad {body.unit_id}", "version": release.version}

    # Por organización — todas las unidades activas tipo totem
    require_org_admin(body.organization_id, current_user, db)

    if str(release.organization_id) != str(body.organization_id):
        raise HTTPException(status_code=404, detail="El release no pertenece a esta organización")

    units = db.query(Unit).filter(
        Unit.organization_id == body.organization_id,
        Unit.type == "totem",
        Unit.is_active == True,
    ).all()

    for unit in units:
        _deploy_to_unit(unit, release, payload, current_user, db)
    db.commit()

    return {
        "detail": f"Firmware {release.version} aplicado a {len(units)} unidades",
        "version": release.version,
        "units": [str(u.id) for u in units],
    }


def _deploy_to_unit(unit: Unit, release: FirmwareRelease, payload: dict, current_user: User, db: Session) -> None:
    now = datetime.now(timezone.utc)
    command = Command(
        id=uuid.uuid4(),
        unit_id=unit.id,
        issued_by=current_user.id,
        type="update_firmware",
        payload=payload,
        created_at=now,
    )
    db.add(command)

    mqtt_client.publish(f"totem/{str(unit.id)}/ota", payload)
    command.delivered_at = datetime.now(timezone.utc)

    unit.target_firmware_release_id = release.id
