import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI

from db import SessionLocal
from models import Alert, Unit
from mqtt import mqtt_client
from routers import alerts, auth, commands, firmware, internal, organizations, profiles, units
from routers import telegram as telegram_router
from routers import live as live_router
from telegram import notify_alert, notify_startup, notify_org_status, start_polling, stop_polling
import ws as ws_module


def _retry_pending_alerts() -> None:
    db = SessionLocal()
    try:
        pending = db.query(Alert).filter(Alert.telegram_sent_at.is_(None)).all()
        if not pending:
            return
        print(f"[startup] {len(pending)} alertas pendientes de Telegram — reintentando")
        for alert in pending:
            unit = db.query(Unit).filter(Unit.id == alert.unit_id).first()
            if not unit:
                continue
            unit_name = unit.name
            org_id = str(unit.organization_id)
            sent = notify_alert(str(alert.unit_id), unit_name, alert.type, alert.severity, alert.message, org_id)
            if sent:
                alert.telegram_sent_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[startup] error reintentando alertas Telegram: {e}")
    finally:
        db.close()


ORG_STATUS_STARTUP_DELAY_SECONDS = 15


async def _delayed_org_status() -> None:
    # Da tiempo a que el cliente MQTT reconecte y las unidades publiquen
    # una lectura fresca antes de calcular quién está activo.
    await asyncio.sleep(ORG_STATUS_STARTUP_DELAY_SECONDS)
    notify_org_status()


@asynccontextmanager
async def lifespan(app: FastAPI):
    ws_module.set_event_loop(asyncio.get_event_loop())
    mqtt_client.connect()
    start_polling()
    _retry_pending_alerts()
    notify_startup()
    asyncio.create_task(_delayed_org_status())
    yield
    stop_polling()
    mqtt_client.disconnect()


app = FastAPI(title="Totem Server", version="0.1.0", lifespan=lifespan)

app.include_router(auth.router,            prefix="/api/v1")
app.include_router(organizations.router,   prefix="/api/v1")
app.include_router(units.router,           prefix="/api/v1")
app.include_router(profiles.router,        prefix="/api/v1")
app.include_router(firmware.router,        prefix="/api/v1")
app.include_router(commands.router,        prefix="/api/v1")
app.include_router(alerts.router,          prefix="/api/v1")
app.include_router(telegram_router.router, prefix="/api/v1")
app.include_router(live_router.router)
app.include_router(internal.router)


@app.get("/health", include_in_schema=False)
def health():
    return {"status": "ok"}
