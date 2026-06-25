import uuid

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db import get_db
from models import Unit

router = APIRouter()


class MqttAuthPayload(BaseModel):
    username: str
    password: str
    clientid: str


@router.post("/api/internal/mqtt/auth")
def mqtt_auth(payload: MqttAuthPayload, db: Session = Depends(get_db)):
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
