from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI

from db import SessionLocal
from models import Alert, Unit
from mqtt import mqtt_client
from routers import alerts, auth, commands, firmware, internal, organizations, profiles, units
from telegram import notify_alert


def _retry_pending_alerts() -> None:
    db = SessionLocal()
    try:
        pending = db.query(Alert).filter(Alert.telegram_sent_at.is_(None)).all()
        if not pending:
            return
        print(f"[startup] {len(pending)} alertas pendientes de Telegram — reintentando")
        for alert in pending:
            unit = db.query(Unit).filter(Unit.id == alert.unit_id).first()
            unit_name = unit.name if unit else str(alert.unit_id)
            sent = notify_alert(unit_name, alert.type, alert.severity, alert.message)
            if sent:
                alert.telegram_sent_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[startup] error reintentando alertas Telegram: {e}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    mqtt_client.connect()
    _retry_pending_alerts()
    send_message("🟢 <b>Totem Server iniciado</b>")
    yield
    mqtt_client.disconnect()


app = FastAPI(title="Totem Server", version="0.1.0", lifespan=lifespan)

app.include_router(auth.router,          prefix="/api/v1")
app.include_router(organizations.router, prefix="/api/v1")
app.include_router(units.router,         prefix="/api/v1")
app.include_router(profiles.router,      prefix="/api/v1")
app.include_router(firmware.router,      prefix="/api/v1")
app.include_router(commands.router,      prefix="/api/v1")
app.include_router(alerts.router,        prefix="/api/v1")
app.include_router(internal.router)
