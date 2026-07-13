from datetime import datetime, timezone
from typing import Optional

_units: dict = {}


def update_readings(unit_id: str, payload: dict) -> None:
    if unit_id not in _units:
        _units[unit_id] = {"pump_state": "off"}
    _units[unit_id]["readings"] = payload
    _units[unit_id]["last_seen"] = datetime.now(timezone.utc).isoformat()


# Estado instantáneo del suministro que reportan los dispositivos en
# totem/<unit_id>/events, para la vista en vivo (WebSocket). Es distinto de
# los eventos de auditoría que se persisten en device_events (ver mqtt.py).
#
# firmware/genesis publica el estado en el campo "state" con los tokens de su
# máquina de suministro: "pump_on" (bomba regando), "supplying" (válvula NC
# abierta, esperando al flotador) y "off" (todo apagado).
#
# Se aceptan también los tokens de publicadores más viejos por compatibilidad:
# firmware/simulator (ESP32) manda "pump_off" y el simulador Python "ON"/"OFF".
_ACTION_TO_STATE = {
    "pump_on": "on",
    "supplying": "supplying",
    "off": "off",
    "pump_off": "off",
    "ON": "on",
    "OFF": "off",
}


def update_pump(unit_id: str, action: str) -> None:
    if unit_id not in _units:
        _units[unit_id] = {}
    _units[unit_id]["pump_state"] = _ACTION_TO_STATE.get(action, "off")


def get_unit(unit_id: str) -> Optional[dict]:
    return _units.get(unit_id)
