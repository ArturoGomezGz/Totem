# Perfil de Cultivo Activo

El Perfil de Cultivo Activo es una entidad de configuración que le indica al sistema cómo debe comportarse para una especie de planta específica. Es el puente entre los datos de sensores y las decisiones de riego: sin un perfil activo, el ESP32 no tiene referencia para saber si las condiciones actuales requieren intervención ni cuánto tiempo regar.

Cada unidad Totem tiene un perfil activo asignado en todo momento. El perfil puede cambiarse desde el dashboard — por ejemplo, al iniciar una nueva cosecha con una especie distinta. El ESP32 siempre mantiene una copia local del perfil activo en su flash, para poder tomar decisiones de riego incluso sin conexión a internet (FR-07).

---

## Parámetros

### Condición de disparo de riego

**Decisión — 10 jul 2026:** el disparo de riego se basa en VPD (Déficit de Presión de Vapor), no en Pn estimado por ML. Ver justificación completa en `docs/capa1/totem-principal/sistema-decision/modulo-decision.md`.

- **Umbral de VPD** (kPa) — valor de déficit de presión de vapor por encima del cual el sistema activa la bomba. Cuando VPD calculado ≥ umbral → riego ON (FR-03). Referencia de literatura CEA: rango óptimo general 0.5–0.8 kPa; a afinar por especie.

### Duración del ciclo de riego

**Decisión — 11 jul 2026:** la duración **no es un valor fijo** — se calcula dinámicamente como `base_duration_s × f(VPD) × g(Li)`, con fórmulas cerradas (ver `modulo-decision.md` § "Duración del ciclo"). Un VPD más alto (mayor demanda evaporativa) implica un ciclo más largo; más luz que el punto medio del rango ideal del perfil también lo alarga.

- **Duración base** (`base_duration_s`) — duración del ciclo cuando VPD está justo en el umbral y Li está en el punto medio del rango ideal (sin modulación, `f=g=1.0`).
- `f(VPD)` y `g(Li)` **no agregan parámetros nuevos al perfil** — reutilizan el umbral de VPD y el rango `light_min`/`light_max` que el perfil ya define. Los topes de la fórmula (1.0–2.0 y 0.5–1.5) son constantes del firmware, no configurables por perfil.

### Rangos ideales de variables ambientales

Usados para detección de condiciones fuera de rango y generación de alertas (FR-11, FR-34):

| Variable | Unidad | Notas |
|---|---|---|
| Temperatura (T) | °C | rango mínimo–máximo |
| Humedad relativa (RH) | % | rango mínimo–máximo |
| Intensidad lumínica (Li) | µmol/m²/s | 🔴 pendiente confirmar unidad según sensor seleccionado — sensor actual del prototipo (fotorresistor/LDR) no da mediciones confiables, pendiente de reemplazo y validación |

CO₂ fue evaluado y descartado del conjunto de sensores (10 jul 2026) — ya no aplica como rango de alerta. Ver `docs/capa1/totem-principal/sistema-decision/modulo-decision.md`.

---

## Ciclo de vida en el sistema

```
1. Usuario crea o edita un perfil en el dashboard (FR-16)
2. Usuario asigna ese perfil como activo a una unidad Totem (FR-32)
3. El backend publica el perfil actualizado al topic MQTT `totem/{unit_id}/profile` (FR-17)
4. El ESP32 (suscrito al topic) recibe el perfil en milisegundos (FR-09)
5. El ESP32 guarda el perfil en su flash local (FR-07), sobreescribiendo el anterior
6. A partir de ese momento, todas las decisiones de riego usan el nuevo perfil
7. Sin conexión, el ESP32 sigue usando el último perfil conocido en flash
```

---

## Pendientes de definir

- **Valores de referencia por especie** — umbral de VPD y duración base concretos para las especies contempladas (lechuga, albahaca, cilantro, etc.), partiendo de la referencia general de literatura CEA (0.5–0.8 kPa)
- **Unidad de Li** — lux vs. µmol/m²/s — depende del sensor seleccionado (sensor actual del prototipo aún no validado; mientras tanto, `g(Li)` funciona igual con Li simulado que con el sensor real)
- **Validaciones de rango** — ¿puede el usuario ingresar cualquier valor, o hay límites para evitar configuraciones peligrosas?
- **Perfil por defecto (factory state)** — ¿qué hace el ESP32 si arranca por primera vez sin haber recibido nunca un perfil? ¿Valores conservadores hardcodeados, o espera conexión antes de operar? Ver `docs/ecosistema/overview.md` — decisiones pendientes.

---

## Documentos relacionados

- `docs/requirements.md` — FR-02, FR-03, FR-07, FR-09, FR-16, FR-17, FR-32
- `docs/capa1/totem-principal/sistema-decision/modulo-decision.md` — el umbral de VPD y las fórmulas de `f(VPD)`/`g(Li)` — decisión del 11 jul 2026
- `docs/ecosistema/overview.md` — el perfil vive en la DB de Capa 2 y se cachea en flash del ESP32
- `docs/capa2/schema.md` — tabla `crop_profiles`
