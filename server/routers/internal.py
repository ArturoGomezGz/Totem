import uuid

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

import config
from db import get_db
from models import Unit

router = APIRouter()


class MqttAuthPayload(BaseModel):
    username: str
    password: str
    clientid: str


class MqttSuperuserPayload(BaseModel):
    username: str


class MqttAclPayload(BaseModel):
    username: str
    clientid: str
    topic: str
    acc: int


@router.post("/api/internal/mqtt/auth")
def mqtt_auth(payload: MqttAuthPayload, db: Session = Depends(get_db)):
    # El server se autentica con sus propias credenciales, no como unidad
    if payload.username == config.MQTT_USERNAME:
        if payload.password == config.MQTT_PASSWORD:
            return Response(status_code=200)
        return Response(status_code=401)

    try:
        unit_id = uuid.UUID(payload.username)
    except ValueError:
        return Response(status_code=401)

    unit = db.query(Unit).filter(
        Unit.id == unit_id,
        Unit.api_key == payload.password,
        Unit.is_active == True,
    ).first()

    if not unit:
        return Response(status_code=401)

    return Response(status_code=200)


@router.post("/api/internal/mqtt/superuser")
def mqtt_superuser(payload: MqttSuperuserPayload):
    # Ningún cliente es superusuario — todos están sujetos a ACL
    return Response(status_code=401)


@router.post("/api/internal/mqtt/acl")
def mqtt_acl(payload: MqttAclPayload):
    # Sin restricciones de topics en el MVP — cualquier cliente autenticado
    # puede publicar y suscribirse a cualquier topic
    return Response(status_code=200)
