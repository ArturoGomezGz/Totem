import os
from dotenv import load_dotenv

load_dotenv()

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_CLIENT_ID = os.getenv("MQTT_CLIENT_ID", "totem-server")
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "server")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
