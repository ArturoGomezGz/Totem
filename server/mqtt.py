import json
import uuid
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from config import MQTT_HOST, MQTT_PORT, MQTT_CLIENT_ID, MQTT_USERNAME, MQTT_PASSWORD
from db import SessionLocal
from models import Alert, DeviceEvent, Reading, Unit

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
            self._persist_reading(unit_id, payload)
        elif kind == "events" and "action" in payload:
            state.update_pump(unit_id, payload["action"])
        elif kind == "alerts":
            self._persist_alert(unit_id, payload)

    def _persist_reading(self, unit_id_str: str, payload: dict) -> None:
        db = SessionLocal()
        try:
            db.add(Reading(
                unit_id=uuid.UUID(unit_id_str),
                timestamp=datetime.now(timezone.utc),
                temperature=payload.get("temperature"),
                humidity=payload.get("humidity"),
                light=payload.get("light"),
                co2=payload.get("co2"),
            ))
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[mqtt] error persistiendo lectura: {e}")
        finally:
            db.close()

    def _persist_alert(self, unit_id_str: str, payload: dict) -> None:
        from telegram import notify_alert

        alert_type = payload.get("type", "unknown")
        severity   = payload.get("severity", "warning")
        message    = payload.get("message")

        db = SessionLocal()
        try:
            unit = db.query(Unit).filter(Unit.id == unit_id_str).first()
            unit_name = unit.name if unit else unit_id_str

            alert = Alert(
                unit_id=uuid.UUID(unit_id_str),
                timestamp=datetime.now(timezone.utc),
                type=alert_type,
                severity=severity,
                message=message,
            )
            db.add(alert)
            db.flush()

            sent = notify_alert(unit_name, alert_type, severity, message)
            if sent:
                alert.telegram_sent_at = datetime.now(timezone.utc)

            db.commit()
            print(f"[mqtt] alerta persistida — telegram={'ok' if sent else 'pendiente'}")
        except Exception as e:
            db.rollback()
            print(f"[mqtt] error persistiendo alerta: {e}")
        finally:
            db.close()


mqtt_client = MQTTClient()
