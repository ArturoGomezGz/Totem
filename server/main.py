from contextlib import asynccontextmanager

from fastapi import FastAPI

from mqtt import mqtt_client
from routers import alerts, auth, commands, internal, organizations, units


@asynccontextmanager
async def lifespan(app: FastAPI):
    mqtt_client.connect()
    yield
    mqtt_client.disconnect()


app = FastAPI(title="Totem Server", version="0.1.0", lifespan=lifespan)

app.include_router(auth.router,          prefix="/api/v1")
app.include_router(organizations.router, prefix="/api/v1")
app.include_router(units.router,         prefix="/api/v1")
app.include_router(commands.router,      prefix="/api/v1")
app.include_router(alerts.router,        prefix="/api/v1")
app.include_router(internal.router)
