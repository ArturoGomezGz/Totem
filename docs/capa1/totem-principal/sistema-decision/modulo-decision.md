# Módulo de Decisión de Riego

El Módulo de Decisión de Riego es la unidad central de toma de decisiones del firmware ESP32. Determina cuándo y por cuánto tiempo irrigar en función de la tasa de fotosíntesis estimada (Pn) de la planta.

**Principio central:** el riego responde al estado fisiológico real de la planta, no a intervalos de tiempo fijos. Un Pn alto indica que la planta está activa y demanda agua; un Pn bajo señala demanda reducida o estrés potencial.

Este enfoque está respaldado por múltiples estudios en agricultura de ambiente controlado donde modelos de ML entrenados con datos de sensores ambientales han predicho Pn con R² consistentemente superiores a 0.95.

---

## Entradas

Cuatro variables ambientales recolectadas en tiempo real desde la cámara aeropónica:

| Variable | Símbolo | Sensor |
|---|---|---|
| Temperatura | T | Sensor de temperatura |
| Humedad relativa | RH | Sensor de humedad |
| Intensidad lumínica | Li | Sensor de luz / PAR |
| Concentración de CO₂ | CO₂ | Sensor de CO₂ |

Estas cuatro variables son el conjunto mínimo suficiente para estimación precisa de Pn en ambientes controlados según la literatura revisada. Variables adicionales (conductancia estomática, clorofila, fluorescencia) requieren equipos incompatibles con las restricciones de diseño de Totem.

---

## Modelo de estimación de Pn

### Contexto

Existen dos familias de modelos para estimación de Pn:

**Modelos numéricos / biofísicos** (ej. FvCB, hipérbola rectangular) — derivan predicciones de ecuaciones fisiológicas. Alcanzan R² hasta 0.999 en condiciones estables, pero requieren parámetros intrínsecos de la planta (Vcmax, Jmax) difíciles de medir en campo y su precisión se degrada bajo condiciones dinámicas.

**Modelos de aprendizaje automático** — aprenden la relación entre entradas ambientales y Pn a partir de datos empíricos. Manejan bien relaciones no lineales y condiciones dinámicas, generalizan entre cultivares con datos suficientes, y solo requieren los cuatro sensores descritos.

### Modelos candidatos

Validados en la literatura para predicción de Pn con T, RH, Li y CO₂:

| Modelo | Entradas | Cultivo | Precisión |
|---|---|---|---|
| SVR + BPNN | T, CO₂, Li | Pepino | R² = 0.998 / 0.996 |
| ANN | T, RH, CO₂, PPFD | Espinaca | R² > 0.90 |
| WDNN | T, RH, CO₂, PAR | Tomate | R² = 0.97 |
| SVR + RF | T, CO₂, Li, LQ | — | R² = 0.990 / 0.998 |
| PSO-SVM | T, RH, CO₂, Li | — | R² = 0.96 |
| SVR + GA + BPNN | T, RH, Li, CO₂, SM | Tomate | R² = 0.9738 |

SVR es particularmente efectivo con conjuntos de datos pequeños — relevante para la fase temprana de Totem antes de acumular datos propios. BPNN modela relaciones no lineales con mayor flexibilidad pero es computacionalmente más costoso de entrenar.

### Ubicación de inferencia

**Decidido: en dispositivo** (22 jun 2026) — el modelo corre en el ESP32 como archivo `.tflite`. La inferencia es completamente local y no depende del server. Ver `docs/ecosistema/overview.md`.

### Selección de algoritmo

🔴 **Pendiente (OI-IRR-01):** el algoritmo específico (o combinación) no ha sido decidido. Depende de: (1) cultivo objetivo, (2) fuentes de datos de entrenamiento disponibles, y (3) balance entre precisión y costo computacional en el ESP32.

---

## Lógica de decisión de riego

### Estructura de decisión

- Pn estimado **< umbral del perfil activo** → activar bomba (duración dinámica)
- Pn estimado **≥ umbral** → no regar

El umbral no es una constante global — varía por especie de cultivo y etapa de crecimiento. Lo provee el Perfil de Cultivo Activo en tiempo de ejecución (ver `docs/transversal/crop-profile.md`).

### Función Pn → duración del ciclo

🔴 **Pendiente (OI-IRR-02):** la función que mapea un valor de Pn a una duración de riego no está definida. Opciones:

- **Binario con duración fija** — ON/OFF con tiempo de ciclo constante definido en el perfil
- **Proporcional** — Pn más bajo activa ciclo más largo (función lineal, inversa u otra)
- **Tabla de consulta** — rangos discretos de Pn mapeados a duraciones, indexados por perfil y etapa de crecimiento

---

## Versatilidad por cultivo

### Motivación

Distintos usuarios cultivan distintas especies. Las especies difieren significativamente en rangos óptimos de Pn, curvas de demanda hídrica y sensibilidad a los intervalos de riego. Un modelo calibrado exclusivamente para tomate puede no rendir óptimamente para lechuga o albahaca.

### Estrategias candidatas

**Modelo universal con parámetros de cultivo:** un solo modelo ML entrenado con múltiples cultivos donde la especie y etapa de crecimiento se proveen como características de entrada adicionales. El Perfil de Cultivo Activo suministra estos parámetros en tiempo de ejecución — el modelo adapta su comportamiento sin cambiar de modelo.

**Modelos por cultivo con cambio en tiempo de ejecución:** modelos ML separados por cultivo; el activo se selecciona según el Perfil de Cultivo Activo. Maximiza precisión por cultivo pero aumenta la huella de almacenamiento en el ESP32 y la complejidad de gestión de modelos.

**Enfoque híbrido:** modelo base único con capas de ajuste fino o coeficientes de corrección por cultivo.

🔴 **Pendiente (OI-IRR-04):** la estrategia no ha sido decidida. El enfoque elegido influye en la arquitectura del modelo, los requisitos de datos de entrenamiento, la huella de almacenamiento en el ESP32 y el esquema del Perfil de Cultivo Activo.

---

## Decisiones pendientes

| ID | Ítem | Notas |
|---|---|---|
| OI-IRR-01 | Selección de algoritmo ML para estimación de Pn | Depende del cultivo objetivo, disponibilidad de datos y restricciones de cómputo en el ESP32 |
| OI-IRR-02 | Función de mapeo Pn → duración de riego | Binario con duración fija vs. proporcional vs. tabla de consulta |
| OI-IRR-03 | Definición del umbral de Pn por cultivo/etapa | Lo proveerá el Perfil de Cultivo Activo — pendiente de valores concretos por especie |
| OI-IRR-04 | Estrategia de versatilidad por cultivo | Modelo único vs. modelos por cultivo vs. híbrido |
| OI-IRR-05 | Fuente de datos de entrenamiento | Datasets de literatura vs. datos propios de Totem vs. combinación |
| ~~OI-IRR-06~~ | ~~Ubicación de la inferencia~~ | **Decidido: en dispositivo (22 jun 2026)** |

---

## Documentos relacionados

- `docs/transversal/crop-profile.md` — el umbral de Pn y la función de duración son parámetros del perfil
- `docs/requirements.md` — FR-02, FR-03
- `docs/ecosistema/overview.md` — ubicación de inferencia, flujo de datos del módulo
