"""
Genera lecturas sintéticas de sensores con ciclo día/noche y ruido realista.

Rangos basados en condiciones típicas de cultivo aeropónico interior:
  T      18–26 °C          correlacionado con luz
  RH     65–80 %           inverso a T; sube ~5% cuando la bomba está activa
  Li     0–900 µmol/m²/s  sinusoidal 06:00–20:00 UTC

Sensores de gas (fase de prueba, solo monitoreo): conteo crudo del ADC
0–4095 sin calibrar, igual que el firmware genesis. Se generan alrededor de
una línea base con ruido; no modelan un fenómeno físico real.
  air_quality  Grove Air Quality Sensor v1.3 (índice genérico)
  methane      MQ-4 (salida analógica)
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

    # Conteo crudo del ADC (0-4095) alrededor de una línea base con ruido.
    air_quality = round(min(4095.0, max(0.0, 150.0 + random.uniform(-40.0, 40.0))), 1)
    methane = round(min(4095.0, max(0.0, 300.0 + random.uniform(-60.0, 60.0))), 1)

    return {
        "temperature": temperature,
        "humidity": humidity,
        "light": light,
        "air_quality": air_quality,
        "methane": methane,
    }
