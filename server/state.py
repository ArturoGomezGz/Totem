from typing import Optional

_units: dict = {}


def update_readings(unit_id: str, payload: dict) -> None:
    if unit_id not in _units:
        _units[unit_id] = {"pump_on": False}
    _units[unit_id]["readings"] = payload
    _units[unit_id]["last_seen"] = payload.get("timestamp")


def update_pump(unit_id: str, action: str) -> None:
    if unit_id not in _units:
        _units[unit_id] = {}
    _units[unit_id]["pump_on"] = action == "ON"


def get_unit(unit_id: str) -> Optional[dict]:
    return _units.get(unit_id)
