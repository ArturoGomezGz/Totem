from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from mqtt import mqtt_client

router = APIRouter()


class Command(BaseModel):
    type: Literal["pump_on", "pump_off"]


@router.post("/units/{unit_id}/commands")
def send_command(unit_id: str, command: Command):
    mqtt_client.publish(f"totem/{unit_id}/commands", {"type": command.type})
    return {"status": "published", "unit_id": unit_id, "command": command.type}
