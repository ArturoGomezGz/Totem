import hashlib
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from config import FIRMWARE_DIR, SERVER_URL
from db import get_db
from models import FirmwareRelease, Membership, Unit, User
from mqtt import mqtt_client

router = APIRouter(tags=["firmware"])


# ---------- Schemas ----------

class FirmwareReleaseOut(BaseModel):
    version: str
    sha256: str
    released_at: datetime
    download_url: str

    model_config = {"from_attributes": True}


class DeployIn(BaseModel):
    unit_id: Optional[str] = None
    organization_id: Optional[str] = None


# ---------- Helpers ----------

def _release_to_out(r: FirmwareRelease) -> FirmwareReleaseOut:
    return FirmwareReleaseOut(
        version=r.version,
        sha256=r.sha256,
        released_at=r.released_at,
        download_url=f"{SERVER_URL}/api/v1/firmware/{r.version}/binary",
    )


# ---------- Endpoints ----------

@router.get(
    "/firmware",
    summary="Listar versiones de firmware disponibles",
    description="""
**¿Qué hace?**
Devuelve todas las versiones de firmware publicadas, ordenadas de más reciente a más antigua.

**¿Para qué?**
Permite al administrador ver qué versiones están disponibles para desplegar via OTA
y consultar el hash SHA-256 de cada binario para verificación de integridad.

**¿Dónde se usa?**
Panel de gestión de firmware — listado de releases disponibles.
""",
    response_model=list[FirmwareReleaseOut],
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
    },
)
def list_firmware(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    releases = db.query(FirmwareRelease).order_by(FirmwareRelease.released_at.desc()).all()
    return [_release_to_out(r) for r in releases]


@router.post(
    "/firmware",
    summary="Publicar una versión de firmware",
    description="""
**¿Qué hace?**
Recibe un binario `.bin` compilado para ESP32, calcula su SHA-256, lo guarda en el
filesystem del servidor y registra el release en la base de datos.

**¿Para qué?**
Alta de una nueva versión de firmware lista para desplegar via OTA a los dispositivos.
El binario queda almacenado en el volumen `firmware-data` del servidor.

**¿Dónde se usa?**
Flujo de release de firmware — acción "Publicar versión" del panel de administración.

> **Nota:** `version` debe ser semántica (`1.2.0`). Si ya existe una versión con ese
> nombre, el endpoint devuelve 409 sin sobrescribir el binario existente.
""",
    response_model=FirmwareReleaseOut,
    status_code=201,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        409: {"description": "Ya existe un release con esa versión"},
    },
)
async def upload_firmware(
    version: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = db.query(FirmwareRelease).filter(FirmwareRelease.version == version).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Ya existe un release para la versión {version}")

    content = await file.read()
    sha256 = hashlib.sha256(content).hexdigest()

    os.makedirs(FIRMWARE_DIR, exist_ok=True)
    binary_path = os.path.join(FIRMWARE_DIR, f"totem-{version}.bin")

    with open(binary_path, "wb") as f:
        f.write(content)

    release = FirmwareRelease(
        version=version,
        binary_path=binary_path,
        sha256=sha256,
        released_at=datetime.now(timezone.utc),
    )
    db.add(release)
    db.commit()
    db.refresh(release)

    return _release_to_out(release)


@router.get(
    "/firmware/{version}/binary",
    summary="Descargar binario de una versión de firmware",
    description="""
**¿Qué hace?**
Sirve el archivo `.bin` del firmware correspondiente a la versión indicada
como descarga directa (`application/octet-stream`).

**¿Para qué?**
Endpoint que consume el ESP32 durante el proceso OTA: recibe la URL de descarga
via MQTT y hace un GET a este endpoint para obtener el binario.

**¿Dónde se usa?**
Llamado directamente por el firmware del ESP32 durante una actualización OTA.
No requiere autenticación — el dispositivo no tiene JWT.
""",
    responses={
        404: {"description": "Versión de firmware no encontrada"},
    },
)
def download_firmware(
    version: str,
    db: Session = Depends(get_db),
):
    release = db.query(FirmwareRelease).filter(FirmwareRelease.version == version).first()
    if not release:
        raise HTTPException(status_code=404, detail="Versión no encontrada")

    if not os.path.exists(release.binary_path):
        raise HTTPException(status_code=404, detail="Binario no encontrado en el servidor")

    return FileResponse(
        path=release.binary_path,
        media_type="application/octet-stream",
        filename=f"totem-{version}.bin",
    )


@router.post(
    "/firmware/{version}/deploy",
    summary="Notificar actualización OTA a una o varias unidades",
    description="""
**¿Qué hace?**
Publica la notificación de nueva versión disponible al topic MQTT de la unidad
(`totem/{unit_id}/ota`) con la versión, URL de descarga y hash SHA-256.
El ESP32 suscrito al topic inicia la descarga y aplica la actualización.

**¿Para qué?**
Desencadena el proceso OTA en el dispositivo sin intervención física.
El firmware verifica el SHA-256 antes de aplicar el binario.

**¿Dónde se usa?**
Panel de gestión de firmware — acción "Desplegar" sobre una versión publicada.

**Targeting:**
Exactamente uno de los dos campos debe estar presente:

| Campo | Efecto |
|---|---|
| `unit_id` | Envía OTA a una sola unidad |
| `organization_id` | Envía OTA a todas las unidades activas de la organización |
""",
    responses={
        200: {"description": "Notificación publicada"},
        400: {"description": "Debe especificarse unit_id o organization_id (no ambos, no ninguno)"},
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "El usuario no tiene acceso a la unidad u organización indicada"},
        404: {"description": "Versión, unidad u organización no encontrada"},
    },
)
def deploy_firmware(
    version: str,
    body: DeployIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if bool(body.unit_id) == bool(body.organization_id):
        raise HTTPException(
            status_code=400,
            detail="Especifica exactamente uno: unit_id o organization_id",
        )

    release = db.query(FirmwareRelease).filter(FirmwareRelease.version == version).first()
    if not release:
        raise HTTPException(status_code=404, detail="Versión no encontrada")

    payload = {
        "version": release.version,
        "url": f"{SERVER_URL}/api/v1/firmware/{release.version}/binary",
        "sha256": release.sha256,
    }

    if body.unit_id:
        unit = db.query(Unit).filter(Unit.id == body.unit_id).first()
        if not unit:
            raise HTTPException(status_code=404, detail="Unidad no encontrada")

        membership = db.query(Membership).filter(
            Membership.user_id == current_user.id,
            Membership.organization_id == unit.organization_id,
        ).first()
        if not membership:
            raise HTTPException(status_code=403, detail="No tienes acceso a esta unidad")

        mqtt_client.publish(f"totem/{body.unit_id}/ota", payload)
        return {"detail": f"OTA publicado a unidad {body.unit_id}", "version": version}

    # Por organización — todas las unidades activas
    membership = db.query(Membership).filter(
        Membership.user_id == current_user.id,
        Membership.organization_id == body.organization_id,
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="No perteneces a esta organización")

    units = db.query(Unit).filter(
        Unit.organization_id == body.organization_id,
        Unit.is_active == True,
    ).all()

    for unit in units:
        mqtt_client.publish(f"totem/{str(unit.id)}/ota", payload)

    return {
        "detail": f"OTA publicado a {len(units)} unidades",
        "version": version,
        "units": [str(u.id) for u in units],
    }
