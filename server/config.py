import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://totem:changeme@localhost:5432/totem")

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_CLIENT_ID = os.getenv("MQTT_CLIENT_ID", "totem-server")
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "server")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))

FIRMWARE_DIR = os.getenv("FIRMWARE_DIR", "/app/data/firmware")
SERVER_URL = os.getenv("SERVER_URL", "http://localhost")

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "")
