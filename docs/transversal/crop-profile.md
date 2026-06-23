# Perfil de Cultivo Activo

El Perfil de Cultivo Activo es una entidad de configuración que le indica al sistema cómo debe comportarse para una especie de planta específica. Es el puente entre los datos de sensores y las decisiones de riego: sin un perfil activo, el ESP32 no tiene referencia para saber si las condiciones actuales requieren intervención ni cuánto tiempo regar.

Cada unidad Totem tiene un perfil activo asignado en todo momento. El perfil puede cambiarse desde el dashboard — por ejemplo, al iniciar una nueva cosecha con una especie distinta. El ESP32 siempre mantiene una copia local del perfil activo en su flash, para poder tomar decisiones de riego incluso sin conexión a internet (FR-07).

---

## Parámetros

### Condición de disparo de riego

- **Umbral de Pn** — valor de tasa de fotosíntesis estimada por debajo del cual el sistema activa la bomba. Cuando Pn calculado < umbral → riego ON (FR-03). Unidad y escala pendientes de la selección del modelo ML.

### Duración del ciclo de riego

- La duración **no es un valor fijo** — se calcula dinámicamente en función del valor de Pn en el momento de la decisión
- Principio general: un Pn más bajo (planta más estresada) implica un ciclo de riego más largo
- 🔴 **Pendiente:** la función exacta que mapea Pn → duración del ciclo (función lineal, tabla de rangos discretos, u otra). Ver `docs/capa1/totem-principal/sistema-decision/modulo-decision.md`.

### Rangos ideales de variables ambientales

Usados para detección de condiciones fuera de rango y generación de alertas (FR-11, FR-34):

| Variable | Unidad | Notas |
|---|---|---|
| Temperatura (T) | °C | rango mínimo–máximo |
| Humedad relativa (RH) | % | rango mínimo–máximo |
| Intensidad lumínica (Li) | µmol/m²/s | 🔴 pendiente confirmar unidad según sensor seleccionado |
| CO₂ | ppm | rango mínimo–máximo |

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

- **Función Pn → duración del ciclo** — bloqueante para la implementación del Módulo de Decisión de Riego
- **Valores de referencia por especie** — rangos ideales concretos para las especies contempladas (lechuga, albahaca, cilantro, etc.). Se definen en paralelo con el desarrollo del modelo de Pn y la revisión de literatura agronómica.
- **Unidad de Li** — lux vs. µmol/m²/s — depende del sensor seleccionado
- **Validaciones de rango** — ¿puede el usuario ingresar cualquier valor, o hay límites para evitar configuraciones peligrosas?
- **Perfil por defecto (factory state)** — ¿qué hace el ESP32 si arranca por primera vez sin haber recibido nunca un perfil? ¿Valores conservadores hardcodeados, o espera conexión antes de operar? Ver `docs/ecosistema/overview.md` — decisiones pendientes.

---

## Documentos relacionados

- `docs/requirements.md` — FR-02, FR-03, FR-07, FR-09, FR-16, FR-17, FR-32
- `docs/capa1/totem-principal/sistema-decision/modulo-decision.md` — el umbral de Pn y la función de duración dependen del modelo ML
- `docs/ecosistema/overview.md` — el perfil vive en la DB de Capa 2 y se cachea en flash del ESP32
- `docs/capa2/schema.md` — tabla `crop_profiles`
