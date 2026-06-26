import asyncio
from fastapi import WebSocket

# event loop del proceso principal — lo inyecta main.py en el lifespan
_loop: asyncio.AbstractEventLoop | None = None


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


class ConnectionManager:
    def __init__(self) -> None:
        # unit_id → conjunto de WebSockets activos
        self._connections: dict[str, set[WebSocket]] = {}

    async def connect(self, unit_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.setdefault(unit_id, set()).add(ws)

    def disconnect(self, unit_id: str, ws: WebSocket) -> None:
        if unit_id in self._connections:
            self._connections[unit_id].discard(ws)

    async def broadcast(self, unit_id: str, data: dict) -> None:
        conns = self._connections.get(unit_id)
        if not conns:
            return
        dead: set[WebSocket] = set()
        for ws in list(conns):
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        conns -= dead

    def broadcast_sync(self, unit_id: str, data: dict) -> None:
        """Llamado desde el thread de MQTT para enviar al event loop de asyncio."""
        if _loop and not _loop.is_closed():
            asyncio.run_coroutine_threadsafe(self.broadcast(unit_id, data), _loop)


manager = ConnectionManager()
