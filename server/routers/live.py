import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from config import JWT_ALGORITHM, JWT_SECRET
from db import SessionLocal
from models import Unit, Membership
from ws import manager
import state

router = APIRouter()


def _verify_token(token: str) -> str | None:
    """Devuelve user_id si el token JWT es válido, None si no."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


def _user_can_access_unit(user_id: str, unit_id: str, db) -> bool:
    unit = db.query(Unit).filter(Unit.id == unit_id, Unit.is_active == True).first()
    if not unit:
        return False
    return db.query(Membership).filter(
        Membership.user_id == user_id,
        Membership.organization_id == unit.organization_id,
    ).first() is not None


@router.websocket("/ws/units/{unit_id}")
async def unit_live(
    unit_id: str,
    ws: WebSocket,
    token: str = Query(...),
):
    user_id = _verify_token(token)
    if not user_id:
        await ws.close(code=4001)
        return

    db = SessionLocal()
    try:
        if not _user_can_access_unit(user_id, unit_id, db):
            await ws.close(code=4003)
            return
    finally:
        db.close()

    await manager.connect(unit_id, ws)
    try:
        # Enviar estado actual al conectar
        current = state.get_unit(unit_id)
        if current:
            await ws.send_json({"type": "state", **current})

        # Mantener la conexión viva — el cliente puede enviar pings
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(unit_id, ws)
