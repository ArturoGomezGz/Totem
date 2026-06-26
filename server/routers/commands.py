from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from db import get_db
from models import User
from mqtt import mqtt_client
from routers.units import _require_unit_access

router = APIRouter(tags=["commands"])


class CommandIn(BaseModel):
    type: Literal["pump_on", "pump_off"]


class CommandAck(BaseModel):
    status: str
    unit_id: str
    command: str


@router.post(
    "/units/{unit_id}/commands",
    summary="Enviar comando manual a una unidad",
    description="""
**¿Qué hace?**
Publica un comando al topic MQTT `totem/{unit_id}/commands` para que el dispositivo
lo ejecute de forma inmediata.

**¿Para qué?**
Permite al operador controlar actuadores manualmente desde el dashboard,
por fuera del ciclo autónomo de decisión del firmware.

**¿Dónde se usa?**
Panel de control manual en la vista de detalle de unidad.
""",
    response_model=CommandAck,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "La unidad no pertenece a una organización del usuario"},
        404: {"description": "Unidad no encontrada"},
    },
    openapi_extra={
        "requestBody": {
            "content": {
                "application/json": {
                    "examples": {
                        "pump_on":  {"summary": "Encender bomba", "value": {"type": "pump_on"}},
                        "pump_off": {"summary": "Apagar bomba",   "value": {"type": "pump_off"}},
                    }
                }
            }
        }
    },
)
def send_command(
    unit_id: str,
    command: CommandIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_unit_access(unit_id, current_user, db)
    mqtt_client.publish(f"totem/{unit_id}/commands", {"type": command.type})
    return CommandAck(status="published", unit_id=unit_id, command=command.type)
