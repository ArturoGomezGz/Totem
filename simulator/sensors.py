"""
Genera lecturas sintéticas de sensores con ciclo día/noche y ruido realista.

Rangos basados en condiciones típicas de cultivo aeropónico interior:
  T      18–26 °C          correlacionado con luz
  RH     65–80 %           inverso a T; sube ~5% cuando la bomba está activa
  Li     0–900 µmol/m²/s  sinusoidal 06:00–20:00 UTC
  CO₂    390–500 ppm       variación aleatoria
"""

import math
import random
from datetime import datetime, timezone


def _light_factor() -> float:
    """0.0 (noche) → 1.0 (mediodía), basado en hora UTC."""
    now = datetime.now(timezone.utc)
    hour = now.hour + now.minute / 60.0
    if hour < 6.0 or hour > 20.0:
        return 0.0
    return max(0.0, math.sin(math.pi * (hour - 6.0) / 14.0))


def read(pump_on: bool) -> dict:
    lf = _light_factor()

    light = round(max(0.0, lf * 900.0 + random.uniform(-20.0, 20.0)), 1)
    temperature = round(18.0 + lf * 8.0 + random.uniform(-0.5, 0.5), 1)

    base_humidity = 80.0 - lf * 15.0
    if pump_on:
        base_humidity += 5.0
    humidity = round(min(100.0, max(0.0, base_humidity + random.uniform(-2.0, 2.0))), 1)

    co2 = round(420.0 + random.uniform(-30.0, 80.0), 1)

    return {
        "temperature": temperature,
        "humidity": humidity,
        "light": light,
        "co2": co2,
    }
