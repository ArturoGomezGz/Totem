from datetime import datetime, timezone
from typing import Optional

_units: dict = {}


def update_readings(unit_id: str, payload: dict) -> None:
    if unit_id not in _units:
        _units[unit_id] = {"pump_on": False}
    _units[unit_id]["readings"] = payload
    _units[unit_id]["last_seen"] = datetime.now(timezone.utc).isoformat()


def update_pump(unit_id: str, action: str) -> None:
    if unit_id not in _units:
        _units[unit_id] = {}
    _units[unit_id]["pump_on"] = action == "pump_on"


def get_unit(unit_id: str) -> Optional[dict]:
    return _units.get(unit_id)
