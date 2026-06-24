import json
import time
from datetime import datetime, timezone
from typing import Optional

import paho.mqtt.client as mqtt

from config import MQTT_HOST, MQTT_PORT, MQTT_USERNAME, MQTT_PASSWORD, UNIT_ID, PUBLISH_INTERVAL
from sensors import read as read_sensors


class TotemSimulator:
    def __init__(self) -> None:
        self._pump_on: bool = False
        self._pump_started_at: Optional[datetime] = None

        self._client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=UNIT_ID)
        self._client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        print(f"[sim] unidad '{UNIT_ID}' -> {MQTT_HOST}:{MQTT_PORT}")
        self._client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
        self._client.loop_start()
        self._publish_loop()

    # ------------------------------------------------------------------
    # MQTT callbacks
    # ------------------------------------------------------------------

    def _on_connect(self, client, userdata, flags, reason_code, properties) -> None:
        if reason_code.is_failure:
            print(f"[sim] conexión rechazada: {reason_code}")
            return
        print(f"[sim] conectado — suscribiéndose a comandos")
        client.subscribe(f"totem/{UNIT_ID}/commands", qos=1)

    def _on_disconnect(self, client, userdata, flags, reason_code, properties) -> None:
        print(f"[sim] desconectado (código {reason_code})")

    def _on_message(self, client, userdata, msg) -> None:
        try:
            payload = json.loads(msg.payload.decode())
        except Exception:
            print(f"[sim] payload inválido en {msg.topic}")
            return

        cmd = payload.get("type")
        print(f"[sim] comando recibido: {cmd}")

        if cmd == "pump_on":
            self._set_pump("ON")
        elif cmd == "pump_off":
            self._set_pump("OFF")
        else:
            print(f"[sim] comando desconocido ignorado: {cmd}")

    # ------------------------------------------------------------------
    # Pump control
    # ------------------------------------------------------------------

    def _set_pump(self, action: str) -> None:
        now = datetime.now(timezone.utc)

        if action == "ON":
            if self._pump_on:
                return
            self._pump_on = True
            self._pump_started_at = now
            event: dict = {
                "unit_id": UNIT_ID,
                "timestamp": now.isoformat(),
                "action": "ON",
                "trigger": "override",
            }
            print(f"[sim] bomba ON")

        elif action == "OFF":
            if not self._pump_on:
                return
            duration = int((now - self._pump_started_at).total_seconds()) if self._pump_started_at else None
            self._pump_on = False
            self._pump_started_at = None
            event = {
                "unit_id": UNIT_ID,
                "timestamp": now.isoformat(),
                "action": "OFF",
                "duration_seconds": duration,
                "trigger": "override",
            }
            print(f"[sim] bomba OFF — duración {duration}s")

        else:
            return

        self._publish(f"totem/{UNIT_ID}/events", event)

    # ------------------------------------------------------------------
    # Publish loop
    # ------------------------------------------------------------------

    def _publish_loop(self) -> None:
        while True:
            readings = read_sensors(self._pump_on)
            payload = {
                "unit_id": UNIT_ID,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                **readings,
            }
            self._publish(f"totem/{UNIT_ID}/readings", payload)
            print(
                f"[sim] lecturas | "
                f"T={readings['temperature']}C  "
                f"RH={readings['humidity']}%  "
                f"Li={readings['light']} PAR  "
                f"CO2={readings['co2']}ppm  "
                f"bomba={'ON' if self._pump_on else 'OFF'}"
            )
            time.sleep(PUBLISH_INTERVAL)

    def _publish(self, topic: str, payload: dict) -> None:
        self._client.publish(topic, json.dumps(payload), qos=1)
