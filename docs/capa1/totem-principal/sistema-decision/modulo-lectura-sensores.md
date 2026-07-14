# Módulo de Lectura de Sensores

Responsabilidad: leer los sensores físicos y traducir sus valores crudos a unidades con las que el [Módulo de Decisión](decision-module.md) puede trabajar.

## Sensores

| Variable | Símbolo | Unidad | Uso |
|---|---|---|---|
| Temperatura | T | °C | Cálculo de VPD → decisión de riego |
| Humedad relativa | RH | % | Cálculo de VPD → decisión de riego |
| Intensidad lumínica | Li | µmol/m²/s (PAR) | Modulador de duración del ciclo de riego (sin ML en el MVP) |
| pH | pH | — | Calidad de la solución del propio tanque del Totem (FR-43) — **no** alimenta la decisión de riego, es monitoreo/alerta independiente |
| Conductividad eléctrica | EC | mS/cm | Calidad de la solución del propio tanque del Totem (FR-43) — mismo estatus que pH |
| Calidad de aire | — | conteo ADC (crudo) | Grove Air Quality Sensor v1.3 — sensor de prueba, **solo monitoreo**, no alimenta la decisión de riego |
| Metano | CH₄ | conteo ADC (crudo) | MQ-4 (salida analógica) — sensor de prueba, **solo monitoreo**, no alimenta la decisión de riego |

**Decisión — 14 jul 2026.** Se incorporan dos sensores de gas de prueba proporcionados por el profesor colaborador: **calidad de aire** (Grove Air Quality Sensor v1.3) y **metano** (MQ-4, salida analógica AO — la salida digital DO no se usa). Ambos son analógicos y en esta fase se publica el **conteo crudo del ADC (0-4095) sin calibrar**, igual criterio que el LDR — la conversión a unidades reales queda para una versión posterior de firmware. Estatus: **solo monitoreo, no alimentan la decisión de riego**. Implementado en `firmware/genesis` 1.5.0. Nota de hardware: el ESP32-C6 solo tiene ADC en GPIO0-GPIO6; para conectar ambos se movió el LED de la válvula de GPIO2 a GPIO18 y así liberar el canal ADC de GPIO2 (metano en GPIO2, calidad de aire en GPIO0). Ver `capa2/schema.md` para las columnas de DB.

**Decisión — 10 jul 2026.** Se descarta el sensor de CO₂ del conjunto de sensores del Módulo de Decisión. El profesor colaborador señaló, por experiencia previa, la dificultad de sostener este tipo de sensor en campo (deriva, calibración frecuente); la literatura revisada confirma el problema (ver `modulo-decision.md`, sección "Por qué se excluye CO₂"). El riego pasa a decidirse por VPD (T + RH) con Li como modulador de duración — ver `modulo-decision.md`.

**Decisión — 9 jul 2026.** Se agregan pH y EC como sensores del propio tanque del Totem, no solo del tanque padre (ver `docs/capa1/tanque-de-suministro/`). Miden la solución en el punto real de entrega a la raíz, que puede diferir del tanque padre por evaporación u otros factores — habilita corrección manual localizada por el usuario, y es la base para una futura mezcla dinámica entre tanques padre (idea capturada en `docs/planned-features.md`, no diseñada aún). Es puramente una adición de firmware + hardware, distribuible por OTA — no requiere cambios en la lógica de decisión de riego ni en el esquema de Capa 2 (columnas nullable ya previstas en `readings`, ver `capa2/schema.md`).

## Independencia

Puede desarrollarse y probarse de forma completamente independiente al resto del sistema. Se recomienda probarlo en conjunto con el Sistema de Riego para observar su comportamiento en tiempo real.

## Pendientes

🔴 Selección de sensores físicos específicos (modelos, fabricantes, protocolo de comunicación con el ESP32).
