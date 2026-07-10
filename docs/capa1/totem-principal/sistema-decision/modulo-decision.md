# Módulo de Decisión de Riego

El Módulo de Decisión de Riego es la unidad central de toma de decisiones del firmware ESP32. Determina cuándo y por cuánto tiempo irrigar en función del **Déficit de Presión de Vapor (VPD)**, con la intensidad lumínica como modulador de la duración del ciclo.

**Principio central:** el riego responde a la demanda evaporativa real del aire alrededor de la planta, no a intervalos de tiempo fijos. Un VPD alto indica que el aire "exige" más agua de la que la planta puede reponer por transpiración; un VPD bajo señala baja demanda hídrica.

---

## Decisión — 10 jul 2026

**Se abandona la estimación de Pn (tasa de fotosíntesis) por Machine Learning como base de la decisión de riego, y se reemplaza por un cálculo de VPD con fórmula cerrada, más un modulador de duración por intensidad lumínica sin ML en el MVP.** Esta decisión resuelve OI-IRR-01, OI-IRR-02, OI-IRR-04 y OI-IRR-05 (ver tabla al final) y cierra la ~~exclusión provisional de CO₂~~ como definitiva.

### Por qué se excluye CO₂

El profesor colaborador señaló, por experiencia previa trabajando con este tipo de sensor, que la medición de CO₂ es complicada de sostener en campo. Esto coincide con la literatura revisada en `investigacion-alternativas-pn.md`:

- Los sensores NDIR de bajo costo (los únicos viables para el presupuesto de Totem) muestran **deriva (drift)** documentada — errores de 5–21 ppm frente a un analizador de referencia sin calibrar, agravados por condiciones ambientales cambiantes ([NIST](https://www.nist.gov/publications/performance-and-environmental-correction-low-cost-ndir-co2-sensor); [PMC6463532](https://pmc.ncbi.nlm.nih.gov/articles/PMC6463532/)).
- Corregir esa deriva con ML requiere un modelo de calibración adicional entrenado contra un sensor de referencia (mejora de RMSE de 9.6 a 1.9 ppm reportada en [MDPI Sensors 24(17):5675](https://www.mdpi.com/1424-8220/24/17/5675)) — trabajo de ingeniería extra que no es viable mantener en unidades autónomas desatendidas y dispersas geográficamente.
- El sensor económico más común (MH-Z19B) **requiere calibración diaria** para precisión aceptable ([datasheet Winsen](https://www.winsen-sensor.com/d/files/infrared-gas-sensor/mh-z19b-co2-ver1_0.pdf)); alternativas mejor compensadas (SCD30/SCD41) cuestan 3–5× más y solo mitigan el problema, no lo eliminan.
- La torre aeropónica está abierta al ambiente (no es una cámara semicerrada de invernadero), lo que agrava la relación señal/ruido del CO₂ medido frente al CO₂ real de interés fisiológico.

**Conclusión:** el problema no es que el CO₂ no aporte valor al modelo — la literatura confirma que sí lo hace (ver más abajo). El problema es *operativo*: mantener sensores NDIR calibrados y confiables en unidades de bajo costo, desatendidas y replicables por terceros, contradice el principio de replicabilidad de Totem (`CLAUDE.md`). Se acepta la pérdida de precisión que esto implica frente a un modelo de Pn con CO₂, a cambio de eliminar una carga de mantenimiento que ningún usuario final de Totem podría sostener.

### Por qué VPD en vez de Pn con ML

Sin CO₂, un modelo de Pn entrenado solo con T, RH y Li pierde la variable de mayor peso según la literatura confirmada (T, Li y CO₂ son consistentemente las tres entradas más influyentes; ver `investigacion-alternativas-pn.md` sección 4.1). No se encontró evidencia sólida de que un modelo de Pn sin CO₂ alcance los R² > 0.95 reportados con el set completo — es razonable esperar degradación de precisión, no imposibilidad, pero no hay ablation studies públicos que lo confirmen.

En paralelo, la literatura de riego de precisión en agricultura de ambiente controlado (CEA) usa VPD directamente como driver de riego/niebla, sin necesidad de estimar fotosíntesis como paso intermedio:

- VPD es la diferencia entre la humedad de saturación del aire a una temperatura dada y su humedad real — se deriva matemáticamente solo de T y RH (ecuación de Tetens), **sin sensores adicionales a los que Totem ya define**.
- Rango óptimo reportado en CEA: **0.5–0.8 kPa** (uso general) / 0.45–1.25 kPa con óptimo ~0.85 kPa en invernaderos comerciales. VPD > ~2.0 kPa provoca cierre estomático por pérdida de turgor en células guardia — señal clara de estrés hídrico.
- En lechuga específicamente, mantener VPD bajo dentro del rango óptimo se asocia consistentemente con mayor biomasa, fotosíntesis y eficiencia de uso de agua ([Frontiers in Plant Science](https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2021.646144/full); [MDPI Horticulturae 7(2):32](https://www.mdpi.com/2311-7524/7/2/32); [PMC12479579](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12479579/)).
- Existe precedente directo de control de riego por VPD acumulado contra un umbral ajustable por edad fisiológica del cultivo ([patente US4856227 — "Plant oriented control system based upon vapor pressure deficit data"](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/4856227)) — el mismo patrón que usa el Perfil de Cultivo Activo de Totem.
- Es fisiológicamente más directo para *riego* específicamente que Pn: Pn mide actividad fotosintética, no demanda hídrica — una planta puede tener Pn alto sin estar en déficit hídrico. VPD mide directamente la fuerza que empuja el agua fuera de la planta.

Esto corresponde al **Nivel F1 (reglas ambientales)** del panorama de alternativas documentado en `investigacion-alternativas-pn.md`, elegido sobre F2/F3 (Pn por ML, con o sin CO₂) por su simplicidad, costo de mantenimiento nulo y respaldo directo en literatura de control de riego (no solo de estimación de fotosíntesis).

### Por qué la luz no usa ML en el MVP

La intensidad lumínica module la duración del ciclo (más luz → más transpiración potencial → ciclo más largo), pero **sin modelo ML** en esta primera versión, por dos razones concretas:

1. **El sensor de luz del prototipo actual (fotorresistor/LDR) no da mediciones confiables.** Se planea reemplazarlo por uno más preciso, pero ese sensor aún no se ha probado en campo. Construir o calibrar un modelo — aunque sea un coeficiente simple — sobre una señal de entrada que ya se sabe poco confiable no es buen uso del esfuerzo en esta etapa.
2. Restarle peso a esta variable en el MVP es intencional: un modulador simple (coeficiente lineal o tabla de rangos discretos) es suficiente para capturar la dirección del efecto (más luz → ciclo más largo) sin comprometerse a una arquitectura de modelo que tendría que re-entrenarse en cuanto cambie el hardware del sensor.

Cuando el sensor de luz definitivo esté validado, este modulador puede sofisticarse (vía OTA, sin cambio de hardware en el resto del sistema) sin tocar la lógica de VPD, que es independiente.

---

## Cálculo

### VPD (Déficit de Presión de Vapor)

Fórmula cerrada, sin entrenamiento, ejecutable trivialmente en el ESP32 (ecuación de Tetens):

```
SVP(T) = 0.6108 · exp(17.27·T / (T + 237.3))    [kPa]  — presión de saturación de vapor
VPD    = SVP(T) · (1 − RH/100)                  [kPa]  — déficit real
```

Donde `T` es temperatura en °C y `RH` es humedad relativa en %.

### Duración del ciclo

```
duración_riego = duración_base(perfil) × f(VPD) × g(Li)
```

- `f(VPD)` — escala hacia arriba cuando VPD se acerca o supera el umbral del perfil (más déficit → ciclo más largo).
- `g(Li)` — coeficiente simple (lineal o tabla de rangos), sin modelo ML, que escala hacia arriba con mayor intensidad lumínica. Ver razones arriba para mantenerlo simple en el MVP.

🔴 **Pendiente (OI-IRR-02, alcance reducido):** la forma exacta de `f(VPD)` y los valores de `g(Li)` (tabla de rangos vs. coeficiente lineal, y sus parámetros concretos) — pendiente de calibración, no de decisión de enfoque.

---

## Ubicación de cálculo

**Decidido: en dispositivo** (22 jun 2026, reafirmado 10 jul 2026) — el cálculo corre en el ESP32. Con este enfoque ya **no es un modelo `.tflite`** sino aritmética directa (VPD) más un coeficiente simple (Li) — más liviano aún que la inferencia ML originalmente planeada, y reafirma con más margen el principio de que Capa 1 nunca depende del server (`CLAUDE.md`). Ver `docs/ecosistema/overview.md`.

---

## Versatilidad por cultivo

El Perfil de Cultivo Activo suministra, por especie y etapa de crecimiento:
- Umbral de VPD que dispara riego (kPa)
- Parámetros de `f(VPD)` y `g(Li)` (o su forma tabular)

Al no depender de un modelo ML entrenado, la versatilidad por cultivo deja de requerir "modelo único vs. modelos por cultivo vs. híbrido" (OI-IRR-04 original) — es simplemente un conjunto de parámetros numéricos por perfil, igual que los rangos ambientales ideales que el sistema ya maneja. Esto resuelve OI-IRR-04.

---

## Decisiones pendientes

| ID | Ítem | Notas |
|---|---|---|
| OI-IRR-02 | Forma exacta de `f(VPD)` y `g(Li)` | Alcance reducido a calibración de parámetros, no a selección de algoritmo — ver sección "Cálculo" arriba |
| OI-IRR-03 | Umbral de VPD por cultivo/etapa | Lo proveerá el Perfil de Cultivo Activo — pendiente de valores concretos por especie (0.5–0.8 kPa como referencia general de literatura CEA, a afinar por especie) |
| ~~OI-IRR-01~~ | ~~Selección de algoritmo ML para estimación de Pn~~ | **Resuelto (10 jul 2026):** no aplica — VPD es fórmula cerrada, sin algoritmo que entrenar |
| ~~OI-IRR-04~~ | ~~Estrategia de versatilidad por cultivo~~ | **Resuelto (10 jul 2026):** parámetros numéricos por perfil, sin necesidad de modelo(s) ML |
| ~~OI-IRR-05~~ | ~~Fuente de datos de entrenamiento~~ | **Resuelto (10 jul 2026):** no aplica al modelo base (VPD); solo sería relevante si en el futuro se sofistica `g(Li)` con ML |
| ~~OI-IRR-06~~ | ~~Ubicación de la inferencia~~ | **Decidido: en dispositivo (22 jun 2026, reafirmado 10 jul 2026)** |

---

## Documentos relacionados

- `investigacion-alternativas-pn.md` — panorama completo de alternativas (niveles F0–F5), fuentes y precios de sensores que informaron esta decisión
- `docs/transversal/crop-profile.md` — el umbral de VPD y los parámetros de `f(VPD)`/`g(Li)` son parámetros del perfil
- `docs/requirements.md` — FR-02, FR-03
- `docs/ecosistema/overview.md` — ubicación de cálculo, flujo de datos del módulo
