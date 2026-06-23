# Módulo de Lectura de Sensores

Responsabilidad: leer los sensores físicos y traducir sus valores crudos a unidades con las que el [Módulo de Decisión](decision-module.md) puede trabajar.

## Sensores

| Variable | Símbolo | Unidad |
|---|---|---|
| Temperatura | T | °C |
| Humedad relativa | RH | % |
| Intensidad lumínica | Li | µmol/m²/s (PAR) |
| CO₂ | CO₂ | ppm |

## Independencia

Puede desarrollarse y probarse de forma completamente independiente al resto del sistema. Se recomienda probarlo en conjunto con el Sistema de Riego para observar su comportamiento en tiempo real.

## Pendientes

🔴 Selección de sensores físicos específicos (modelos, fabricantes, protocolo de comunicación con el ESP32).
