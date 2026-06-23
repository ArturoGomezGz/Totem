import os
from dotenv import load_dotenv

load_dotenv()

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "sim-001")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
UNIT_ID = os.getenv("UNIT_ID", "sim-001")
PUBLISH_INTERVAL = int(os.getenv("PUBLISH_INTERVAL", "30"))
