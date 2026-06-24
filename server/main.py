from contextlib import asynccontextmanager

from fastapi import FastAPI

from mqtt import mqtt_client
from routers import commands


@asynccontextmanager
async def lifespan(app: FastAPI):
    mqtt_client.connect()
    yield
    mqtt_client.disconnect()


app = FastAPI(title="Totem Server", version="0.1.0", lifespan=lifespan)

app.include_router(commands.router, prefix="/api/v1")
