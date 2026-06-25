import json
import paho.mqtt.client as mqtt

from config import MQTT_HOST, MQTT_PORT, MQTT_CLIENT_ID, MQTT_USERNAME, MQTT_PASSWORD

SUBSCRIPTIONS = [
    "totem/+/readings",
    "totem/+/events",
    "totem/+/alerts",
]


class MQTTClient:
    def __init__(self) -> None:
        self._client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=MQTT_CLIENT_ID)
        self._client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

    def connect(self) -> None:
        print(f"[mqtt] conectando a {MQTT_HOST}:{MQTT_PORT} como '{MQTT_CLIENT_ID}'")
        self._client.reconnect_delay_set(min_delay=2, max_delay=30)
        self._client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=60)
        self._client.loop_start()

    def disconnect(self) -> None:
        self._client.loop_stop()
        self._client.disconnect()

    def publish(self, topic: str, payload: dict) -> None:
        self._client.publish(topic, json.dumps(payload), qos=1)

    def _on_connect(self, client, userdata, flags, reason_code, properties) -> None:
        if reason_code.is_failure:
            print(f"[mqtt] conexion rechazada: {reason_code}")
            return
        print(f"[mqtt] conectado — suscribiendose a topics")
        for topic in SUBSCRIPTIONS:
            client.subscribe(topic, qos=1)
            print(f"[mqtt]   <- {topic}")

    def _on_disconnect(self, client, userdata, flags, reason_code, properties) -> None:
        print(f"[mqtt] desconectado (codigo {reason_code})")

    def _on_message(self, client, userdata, msg) -> None:
        try:
            payload = json.loads(msg.payload.decode())
            print(f"[mqtt] {msg.topic} | {payload}")
            self._handle(msg.topic, payload)
        except Exception:
            print(f"[mqtt] payload invalido en {msg.topic}")

    def _handle(self, topic: str, payload: dict) -> None:
        import state
        parts = topic.split("/")
        if len(parts) != 3:
            return
        unit_id, kind = parts[1], parts[2]
        if kind == "readings":
            state.update_readings(unit_id, payload)
        elif kind == "events" and "action" in payload:
            state.update_pump(unit_id, payload["action"])


mqtt_client = MQTTClient()
