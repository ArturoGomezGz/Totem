from datetime import datetime, timezone
from typing import Optional

_units: dict = {}


def update_readings(unit_id: str, payload: dict) -> None:
    if unit_id not in _units:
        _units[unit_id] = {"pump_state": "off"}
    _units[unit_id]["readings"] = payload
    _units[unit_id]["last_seen"] = datetime.now(timezone.utc).isoformat()


# El firmware reporta 3 estados en totem/<unit_id>/events (ver
# firmware/genesis/main/genesis.c, irrigation_supply_task): "pump_on" (bomba
# regando), "supplying" (válvula NC abierta, esperando a que el flotador
# suba antes de regar) y "pump_off" (todo apagado).
_ACTION_TO_STATE = {"pump_on": "on", "supplying": "supplying", "pump_off": "off"}


def update_pump(unit_id: str, action: str) -> None:
    if unit_id not in _units:
        _units[unit_id] = {}
    _units[unit_id]["pump_state"] = _ACTION_TO_STATE.get(action, "off")


def get_unit(unit_id: str) -> Optional[dict]:
    return _units.get(unit_id)
