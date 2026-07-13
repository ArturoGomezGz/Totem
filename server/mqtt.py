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
    "totem/+/status",
]

# Valores admitidos en device_events — reflejan los CHECK de la tabla (ver
# docs/capa2/schema.md). Un evento con type/trigger fuera de estos conjuntos se
# descarta antes de tocar la DB para no violar el constraint.
_VALID_EVENT_TYPES = {"pump_on", "pump_off", "valve_open", "valve_close"}
_VALID_EVENT_TRIGGERS = {"autonomous", "override"}


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

    def publish(self, topic: str, payload: dict, retain: bool = False) -> None:
        self._client.publish(topic, json.dumps(payload), qos=1, retain=retain)

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
        from ws import manager
        parts = topic.split("/")
        if len(parts) != 3:
            return
        unit_id, kind = parts[1], parts[2]
        if kind == "readings":
            state.update_readings(unit_id, payload)
            self._persist_reading(unit_id, payload)
            unit_state = state.get_unit(unit_id)
            if unit_state:
                manager.broadcast_sync(unit_id, {"type": "state", **unit_state})
        elif kind == "events":
            # El payload trae dos cosas con consumidores distintos (ver
            # firmware/genesis set_supply): el estado instantáneo para la vista
            # en vivo ("state", o "action" en publicadores viejos) y el arreglo
            # "events" de eventos de auditoría de actuador que se persisten en
            # device_events.
            live = payload.get("state") or payload.get("action")
            if live:
                state.update_pump(unit_id, live)
                unit_state = state.get_unit(unit_id)
                if unit_state:
                    manager.broadcast_sync(unit_id, {"type": "state", **unit_state})
            self._persist_events(unit_id, payload.get("events", []))
        elif kind == "alerts":
            self._persist_alert(unit_id, payload)
        elif kind == "status":
            self._persist_firmware_version(unit_id, payload)

    def _persist_reading(self, unit_id_str: str, payload: dict) -> None:
        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            db.add(Reading(
                unit_id=uuid.UUID(unit_id_str),
                timestamp=now,
                temperature=payload.get("temperature"),
                humidity=payload.get("humidity"),
                light=payload.get("light"),
            ))
            unit = db.query(Unit).filter(Unit.id == unit_id_str).first()
            if unit:
                unit.last_seen = now
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[mqtt] error persistiendo lectura: {e}")
        finally:
            db.close()

    def _persist_events(self, unit_id_str: str, events: list) -> None:
        # Auditoría de riego: persiste cada evento de actuador en device_events.
        # La duración de un ciclo de bomba se deriva luego como diferencia entre
        # un pump_off y su pump_on previo (ver docs/capa2/schema.md).
        if not events:
            return

        db = SessionLocal()
        try:
            unit = db.query(Unit).filter(Unit.id == unit_id_str).first()
            if not unit:
                print(f"[mqtt] evento de unidad desconocida: {unit_id_str}")
                return

            now = datetime.now(timezone.utc)
            persisted = 0
            for ev in events:
                if not isinstance(ev, dict):
                    continue
                ev_type = ev.get("type")
                trigger = ev.get("trigger")
                if ev_type not in _VALID_EVENT_TYPES or trigger not in _VALID_EVENT_TRIGGERS:
                    print(f"[mqtt] evento descartado (type/trigger invalido): {ev}")
                    continue
                # Duración del tramo (solo la traen los cierres pump_off/valve_close).
                # La mide el firmware; se descarta un valor negativo o no numérico.
                duration_s = ev.get("duration_s")
                if not isinstance(duration_s, (int, float)) or duration_s < 0:
                    duration_s = None
                db.add(DeviceEvent(
                    unit_id=uuid.UUID(unit_id_str),
                    timestamp=now,
                    type=ev_type,
                    trigger=trigger,
                    duration_s=duration_s,
                ))
                persisted += 1

            unit.last_seen = now
            db.commit()
            if persisted:
                print(f"[mqtt] {persisted} evento(s) de actuador persistido(s) — unidad {unit_id_str}")
        except Exception as e:
            db.rollback()
            print(f"[mqtt] error persistiendo eventos: {e}")
        finally:
            db.close()

    def _persist_firmware_version(self, unit_id_str: str, payload: dict) -> None:
        version = payload.get("firmware_version")
        if not version:
            return

        db = SessionLocal()
        try:
            unit = db.query(Unit).filter(Unit.id == unit_id_str).first()
            if not unit:
                print(f"[mqtt] status de unidad desconocida: {unit_id_str}")
                return
            unit.firmware_version = version
            db.commit()
            print(f"[mqtt] firmware_version actualizada — unidad {unit_id_str}: {version}")
        except Exception as e:
            db.rollback()
            print(f"[mqtt] error persistiendo firmware_version: {e}")
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
            if not unit:
                print(f"[mqtt] alerta de unidad desconocida: {unit_id_str}")
                return
            unit_name = unit.name
            org_id = str(unit.organization_id)

            alert = Alert(
                unit_id=uuid.UUID(unit_id_str),
                timestamp=datetime.now(timezone.utc),
                type=alert_type,
                severity=severity,
                message=message,
            )
            db.add(alert)
            db.flush()

            sent = notify_alert(unit_id_str, unit_name, alert_type, severity, message, org_id)
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
