# Investigación — Alternativas para estimación del estado hídrico/fotosintético y niveles escalables de firmware

**Estado: investigación que ya informó una decisión tomada.** El 10 jul 2026 se decidió adoptar el **Nivel F1** de este documento (VPD calculado por fórmula cerrada + modulador simple de luz, sin ML) como la decisión definitiva del Módulo de Decisión de Riego, descartando CO₂ del conjunto de sensores. Ver la decisión completa, su justificación y sus citas en `modulo-decision.md`. Este documento se conserva como respaldo de investigación — el resto del contenido (niveles F2–F5, costos de sensores, ruta de experimentación futura) sigue siendo válido como referencia para posibles mejoras posteriores, no como trabajo pendiente bloqueante.

---

## Motivación

El profesor colaborador señaló que la medición de CO₂ ha resultado complicada en la práctica y probablemente quede fuera del diseño. Esto **no implica abandonar la estimación de Pn** como principio de decisión — implica que el conjunto de sensores de entrada (T, RH, Li, CO₂ definido en `modulo-decision.md`) puede necesitar revisión. Totem tiene dos ventajas que permiten experimentar sin comprometerse de inmediato:

1. **OTA** — el modelo `.tflite` y la lógica de decisión pueden actualizarse remotamente sin reemplazar hardware.
2. **Libertad de diseñar por niveles** — nada obliga a que la primera versión de campo use el modelo más sofisticado posible.

Este documento cubre: (1) por qué el CO₂ es difícil, (2) qué alternativas existen sin él, (3) el panorama completo de enfoques — de un temporizador fijo a fluorometría láser —, (4) costos y complejidad de cada sensor, y (5) una propuesta de niveles de firmware para escalar la sofisticación de la toma de decisiones de forma incremental.

---

## 1. Por qué el CO₂ es el sensor más problemático

Los sensores NDIR de bajo costo (los únicos viables para el presupuesto de Totem) tienen tres problemas documentados en la literatura:

- **Deriva (drift) en el tiempo.** Sensores como el SenseAir K30 muestran errores individuales de 5–21 ppm frente a un analizador de gases de referencia sin calibrar, y la deriva se agrava con condiciones ambientales cambiantes (Ejemplo: unidades LP8 con deriva que no se puede corregir con la frecuencia necesaria). La recalibración in situ a escala (múltiples unidades Totem en campo, sin acceso constante) es "a menudo impráctica" según el propio paper del NIST.
- **Calibración compleja.** La mejora de RMSE de 9.6 a 1.9 ppm reportada en el paper de sensores calibrados con ML requiere un modelo de corrección adicional (regresión, gradient boosting o random forest) entrenado contra un sensor de referencia — trabajo de ingeniería adicional no trivial para una unidad de bajo costo autónoma.
- **El sensor económico más común (MH-Z19B) requiere calibración diaria** para mantener precisión aceptable, lo cual es inviable en una unidad desatendida en campo. Alternativas mejor compensadas (Sensirion SCD30/SCD41) resuelven parcialmente esto con compensación interna de T/RH pero cuestan 3–5× más que el MH-Z19B.
- **Necesitan cámara semicerrada** para lecturas estables — en una torre aeropónica abierta al ambiente, el CO₂ ambiental se mezcla constantemente y la señal es más ruidosa que en un invernadero cerrado, lo que agrava el problema de deriva relativo a la señal real que se busca medir.

**Conclusión de esta sección:** el problema no es que el CO₂ no aporte valor al modelo — los papers revisados (sección 4) muestran que sí mejora la R². El problema es *operativo*: mantener sensores NDIR calibrados y confiables en unidades desatendidas, de bajo costo, dispersas geográficamente, es una carga de mantenimiento que contradice el principio de replicabilidad de Totem.

---

## 2. Panorama completo de enfoques — de lo más simple a lo más avanzado

| # | Enfoque | Principio | Sensores | ¿Requiere ML? | Madurez para Totem hoy |
|---|---|---|---|---|---|
| 0 | Temporizador fijo | Riego a intervalos programados, sin retroalimentación | Ninguno | No | Trivial — ya funciona en cualquier timer |
| 1 | Humedad de sustrato/raíz | Umbral de humedad dispara riego | Sensor capacitivo o tensiómetro | No | Alta — tecnología madura, aunque poco documentada específicamente para aeroponía (raíz expuesta, sin sustrato) |
| 2 | VPD (déficit de presión de vapor) | Riego/niebla responde al estrés evaporativo del aire | T + RH (ya presentes en Totem) | No (fórmula psicrométrica cerrada) | Alta — cálculo directo desde T y RH, sin sensores nuevos |
| 3 | Pn estimado por ML sin CO₂ | T, RH, Li como proxies de fotosíntesis | T, RH, Li (sensores ya definidos, menos CO₂) | Sí | Media — pocos papers aíslan el efecto de remover CO₂ del conjunto de entradas; ver sección 4.2 |
| 4 | Pn estimado por ML con CO₂ (spec actual del proyecto) | Modelo empírico completo | T, RH, Li, CO₂ | Sí | Alta en literatura (R² > 0.95 consistente) pero con el problema operativo de CO₂ de la sección 1 |
| 5 | Sensores fisiológicos directos | Medir la señal biológica en vez de inferirla del ambiente | Fluorescencia, porometría, temperatura foliar (CWSI), flujo de savia, dendrometría, electrofisiología, multiespectral | Variable | Baja–media — instrumentos de investigación, algunos con variantes de bajo costo emergentes (ver sección 5) |

Los niveles 0–2 son **reglas fijas** (sin aprendizaje). Los niveles 3–5 requieren un modelo entrenado o al menos un índice calculado a partir de mediciones fisiológicas.

---

## 3. Nivel 0–2 en detalle: enfoques sin ML

### 3.1 Temporizador fijo

Riego en intervalos constantes independientemente del estado de la planta. Es el enfoque de la mayoría de sistemas aeropónicos comerciales de bajo costo. No hay literatura científica relevante que lo respalde como óptimo — es el baseline contra el que se comparan todos los demás métodos.

### 3.2 Humedad de sustrato / raíz

Ampliamente validado en agricultura protegida: sensores capacitivos o tensiómetros disparan riego cuando la humedad cae bajo un umbral. Es el método plant-based más simple y el estándar de facto en viveros e invernaderos ornamentales, según la EPA (WaterSense) y estudios en cultivos de cítricos y ornamentales.

**Limitación específica de Totem:** la aeroponía no tiene sustrato — las raíces están expuestas y nebulizadas directamente. La búsqueda no encontró literatura que aplique sensores de humedad de sustrato directamente a sistemas aeropónicos (la mayoría de fuentes son para sustrato sólido o NFT). Este método probablemente requiera adaptación (p. ej. medir humedad relativa dentro de la cámara de raíces en vez de humedad de sustrato) más que aplicación directa.

### 3.3 VPD — Déficit de presión de vapor

VPD es la diferencia entre la humedad actual del aire y la humedad máxima que el aire podría contener a esa temperatura. Es una métrica derivable matemáticamente de T y RH — **no requiere sensores adicionales a los que Totem ya tiene definidos**. Se usa activamente en invernaderos comerciales para disparar riego, niebla o ventilación:

- Rango ideal reportado en invernaderos: 0.45–1.25 kPa, óptimo alrededor de 0.85 kPa.
- VPD alto (aire "seco" relativo a la temperatura) → la planta transpira más de lo que puede reponer → activar niebla/riego.
- VPD bajo → riesgo de condensación y enfermedad fúngica → ventilar o deshumidificar.

**Por qué es relevante para Totem:** es la opción de "nivel intermedio" más barata de implementar — literalmente una fórmula sobre datos que el sistema ya captura. Podría servir como capa de seguridad/alerta incluso en las versiones que usan ML para Pn (p. ej., activar niebla de emergencia si VPD se dispara, independientemente del ciclo de decisión de riego).

---

## 4. Nivel 3–4: estimación de Pn con Machine Learning

### 4.1 Papers confirmados con T, RH, Li, CO₂ (conjunto de entradas actual del proyecto)

Se confirmaron y ampliaron los modelos ya listados en `modulo-decision.md`, con las fuentes primarias localizadas:

| Modelo | Cultivo | Entradas | R² | Fuente |
|---|---|---|---|---|
| SVR (óptimo entre SVR/BP/RF/RBF) | Pepino, etapa de fructificación | T, Li, CO₂ | R² = 0.9941, RMSE = 0.78 µmol·m⁻²·s⁻¹ | [Horticulturae 11(12):1475](https://doi.org/10.3390/horticulturae11121475) (MDPI, arbitrado) |
| SVR optimizado, con parámetro temporal | Pepino, ciclo completo | T, Li, CO₂ + tiempo | R² = 0.998, MAD = 0.28 | [Agriculture 13(1):204](https://www.mdpi.com/2077-0472/13/1/204) (MDPI, arbitrado) |
| SVR | Chile/pimiento | Multi-factor ambiental | — | [Horticulturae 11(5):502](https://doi.org/10.3390/horticulturae11050502) (MDPI, arbitrado) |
| WDNN (Wide & Deep Neural Network) | Tomate | T, RH, CO₂, PAR | R² = 0.9764, MAE = 0.75, RMSE = 1.33 | [IEEE Xplore — Application of WDNN](https://ieeexplore.ieee.org/document/9389958) (arbitrado) |
| ANN + algoritmo genético | Tomate | T, RH, Li, CO₂ | — | [IJABE — Model for tomato photosynthetic rate](https://ijabe.org/index.php/ijabe/article/view/3127) (arbitrado) |
| PSO-SVM | Tomate, todas las etapas | CO₂, PPFD, T, RH, T suelo, humedad suelo | — | [IJABE — Universality of PSO-SVM](https://ijabe.org/index.php/ijabe/article/view/2580) (arbitrado) |
| RBF mejorada | — | — | — | [Scientific Reports — s41598-022-12932-9](https://www.nature.com/articles/s41598-022-12932-9) (Nature, arbitrado) |

Confirmación: la literatura es consistente en que **T, Li y CO₂ son las tres entradas de mayor peso**; RH aparece con menor consistencia entre estudios (algunos modelos de alto R² no la incluyen, ej. la variante SVR de pepino que usa solo T, Li, CO₂).

### 4.2 ¿Qué tan bien funciona sin CO₂?

Este es el punto crítico dado el comentario del profesor. La búsqueda específica encontró **poca literatura que aísle explícitamente el efecto de remover CO₂** del conjunto de entradas — la mayoría de los papers de Pn en agricultura de ambiente controlado sí lo incluyen porque el CO₂ es una palanca de control activo en invernaderos comerciales (enriquecimiento de CO₂), no solo una variable de monitoreo pasivo.

Hallazgos relevantes:

- Un modelo CNN-ELM que sí predice Pn con alta precisión (R² = 0.976) usa **PPFD, relación luz roja:azul, temperatura de dosel y RH — más CO₂**, es decir, sigue incluyéndolo.
- Estudios que usan **imágenes multiespectrales de UAV** (no sensores puntuales de CO₂) logran estimar Pn a partir de índices espectrales (OSAVI, SAVI, EVI-2, MSAVI-2) derivados de reflectancia foliar — un camino completamente distinto que evita CO₂ pero requiere una cámara multiespectral en vez de sensores puntuales. Ver [PMC11292552 — maíz](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11292552/) y [PMC9905687 — arroz vía UAV](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9905687/), ambos arbitrados.
- Un estudio con regresión lineal múltiple (MLR) logra R² = 0.741–0.955 (variable por temporada) — no queda claro en el resumen si incluye CO₂; sugiere que aun con modelos simples y un subconjunto de variables se puede llegar a precisión "utilizable" aunque no al nivel de SVR/ANN con el set completo.
- Un preprint (no arbitrado aún) sobre predicción de rendimiento de albahaca en hidroponía vertical con IoT usa ML con variables ambientales — relevante como referencia de arquitectura de sistema, pero no está peer-reviewed. Ver [arXiv:2512.22151](https://arxiv.org/pdf/2512.22151).

**Conclusión de esta subsección:** no existe evidencia sólida en la literatura revisada de que un modelo de Pn sin CO₂ alcance la misma precisión (R² > 0.95) que uno con CO₂. Es razonable esperar una **degradación de precisión, no una imposibilidad** — sigue siendo un modelo válido, solo con menor R² esperado. Esto es coherente con el comentario del profesor: quitar CO₂ es viable operativamente, pero probablemente cueste algo de precisión que Totem tendría que aceptar o compensar con otra variable (ver sección 5, especialmente CWSI y multiespectral como candidatos a "reemplazar" la señal que aportaba el CO₂).

🔴 **Brecha de investigación identificada:** valdría la pena buscar específicamente papers de *ablation study* (modelos entrenados con y sin CO₂ sobre el mismo dataset) en vez de comparar papers distintos con datasets distintos — la comparación actual es indirecta. Es una tarea de investigación futura, no resuelta en esta pasada.

---

## 5. Nivel 5: sensores fisiológicos directos

Estos miden la respuesta de la planta directamente en vez de inferirla del ambiente. Son, en general, instrumentos de investigación — pero varios tienen ya variantes de bajo costo emergentes en la literatura reciente, lo que los hace candidatos a "siguiente nivel" de firmware vía OTA + nuevo hardware.

### 5.1 Fluorescencia de clorofila (Fv/Fm)

Mide directamente la eficiencia cuántica máxima del fotosistema II — una señal de estrés muy temprana, antes de síntomas visibles. El estándar de investigación es fluorometría PAM (pulse-amplitude modulation), cara y compleja. Existen dos vías de abaratamiento documentadas:

- **Imagen de fluorescencia de bajo costo sin PAM**, que simplemente captura la fluorescencia emitida por la planta con hardware simplificado — ver [MDPI Sensors 21(6):2055](https://www.mdpi.com/1424-8220/21/6/2055) (arbitrado).
- **Plataforma LED de bajo costo para fluorescencia de dosel** (no de hoja individual) — permite escalar a nivel de canopia. Ver [AoB PLANTS 15(5):plad069](https://academic.oup.com/aobpla/article/15/5/plad069/7320385) (arbitrado).

Instrumento comercial de referencia: **FluorPen FP 110** (Photon Systems Instruments) — fluorómetro PAM portátil, batería, USB/Bluetooth. No se encontró precio público en la búsqueda; instrumentos de esta categoría típicamente rondan los USD 2,000–3,000 (estimación de mercado, sin fuente verificada — confirmar directamente con el fabricante antes de usar esta cifra).

### 5.2 Temperatura foliar / CWSI (Crop Water Stress Index)

Usa un sensor infrarrojo sin contacto para medir temperatura de dosel; cuando la planta cierra estomas por estrés hídrico, transpira menos y su temperatura sube relativo al aire. El CWSI combina esta diferencia con VPD para dar un índice de 0 (sin estrés) a 1 (estrés máximo).

- CWSI ≤ 0.2 → sin estrés hídrico; CWSI > 0.24 → recomendación de irrigar, según un estudio en tomate. Ver [PMC8347285](https://pmc.ncbi.nlm.nih.gov/articles/PMC8347285/) (arbitrado).
- **El sensor MLX90614 (bajo costo, I2C) fue validado explícitamente para esta aplicación**, con RMSE < 1.0 °C frente a instrumentos de referencia en condiciones de laboratorio y viñedo, y correlación significativa entre CWSI y estrés hídrico (R² = 0.72). Ver [MDPI Sensors 24(1):25 — IoT para viña](https://www.mdpi.com/1424-8220/24/1/25) y [PMC9919097](https://pmc.ncbi.nlm.nih.gov/articles/PMC9919097/), ambos arbitrados.

**Este es el candidato más prometedor de este documento para un "nivel intermedio" entre VPD puro y ML completo con CO₂:** el sensor (MLX90614, ~USD 16 según precio verificado en ShillehTek/Amazon) es I2C, económico, ya validado en campo para exactamente este propósito, y la fórmula de CWSI es determinística (no requiere entrenar un modelo ML nuevo, aunque puede combinarse con uno).

### 5.3 Conductancia estomática (porometría)

Mide directamente cuánto están abiertos los estomas — la vía por la que la planta pierde agua y capta CO₂ para fotosíntesis. Instrumento de referencia: **SC-1 Leaf Porometer** (METER Group), portátil, clip sobre hoja, lectura en ~30 segundos. No se encontró precio público verificado; es un instrumento de medición puntual manual, no un sensor fijo de monitoreo continuo — poco compatible con el modelo de unidad autónoma desatendida de Totem sin rediseño significativo. Ver [METER Group SC-1](https://metergroup.com/products/sc-1-leaf-porometer/) (fuente de fabricante, no arbitrada).

### 5.4 Flujo de savia (sap flow) y dendrometría

Miden respectivamente el movimiento de agua dentro del tallo y las micro-variaciones de diámetro del tallo (que se contrae bajo estrés hídrico). Documentados como métodos "plant-based" válidos para programación de riego por extensiones agrícolas gubernamentales (Victoria, Australia). Ver [ISHS — Engineering a sap flow sensor for irrigators](https://ishs.org/ishs-article/991_8/) y [Agriculture Victoria — Plant-based sensors](https://agriculture.vic.gov.au/farm-management/water/irrigation/irrigation-factsheets-and-resources/Plant-based-sensors-for-irrigation.pdf) (fuentes técnicas/gubernamentales, no arbitradas pero de organismo oficial). Requieren instalación física en el tallo — invasivos, de calibración delicada, y la literatura advierte que "los datos crudos son difíciles de interpretar" sin apoyo del fabricante. Baja prioridad para Totem por complejidad de instalación por planta individual.

### 5.5 Electrofisiología vegetal

Mide señales eléctricas de la planta (potencial eléctrico, impedancia) como proxy de estrés hídrico. Tecnología emergente, con ejemplos recientes de:

- Microagujas implantables asistidas por ML — [ScienceDirect, microneedle sensor](https://www.sciencedirect.com/science/article/abs/pii/S0956566324010698) (arbitrado, pero invasivo — requiere insertar electrodos en el tejido).
- Espectroscopía de impedancia eléctrica no invasiva para contenido relativo de agua — encontrada como solicitud de patente de EE. UU. (no peer-reviewed; nivel de evidencia bajo).
- Sensor inalámbrico de potencial eléctrico validado en especies leñosas para programación de riego — [PubMed 25826257](https://pubmed.ncbi.nlm.nih.gov/25826257/) (arbitrado, pero en árboles/vides leñosas, no necesariamente aplicable a hortalizas de hoja).

Tecnología interesante pero inmadura para un sistema replicable de bajo costo hoy — la barrera de la cutícula vegetal limita la señal en métodos no invasivos, y los invasivos comprometen la planta.

### 5.6 Imagen multiespectral / hiperespectral

Cámaras que capturan reflectancia en bandas específicas (rojo, borde rojo, infrarrojo cercano) para calcular índices de vegetación correlacionados con Pn, estado hídrico y estrés temprano — sin contacto, a nivel de dosel completo.

- Estudio reciente describe un **dispositivo multiespectral de bajo costo** para detección temprana de estrés — no se pudo acceder al texto completo (403), pero aparece publicado en iScience 2026, título "Plant stress early detection through a low-cost multispectral device". Pendiente de revisión más profunda si se decide explorar esta vía.
- Aplicado ya a maíz y arroz vía dron con buena correlación a Pn (secciones 4.2 arriba).

Es la opción de mayor potencial para "reemplazar" lo que aportaría el CO₂ sin sus problemas de mantenimiento — mide la señal óptica de la hoja directamente en vez de inferir del ambiente — pero implica pasar de sensores puntuales baratos a una cámara y procesamiento de imagen, un salto de complejidad de firmware y cómputo en el ESP32 (o requeriría delegar el procesamiento, lo cual rompe el principio de decisión autónoma en dispositivo). Se marca como línea de investigación de largo plazo, no de corto plazo.

---

## 6. Costos y especificaciones de sensores concretos

Precios en USD, unidad individual, mercado general (no mayoreo). Confianza indicada por fuente.

| Sensor | Mide | Interfaz | Precio aprox. | Confianza del precio |
|---|---|---|---|---|
| Sensor de humedad capacitivo genérico | Humedad de sustrato | Analógico | USD 2–5 | Conocimiento general de mercado, no verificado en esta sesión |
| Tensiómetro (ej. Irrometer) | Tensión de agua en sustrato | Manual/analógico | USD 50–80 | Conocimiento general de mercado, no verificado |
| BME280 | T, RH, presión | I2C | **USD 9.98** | Verificado (búsqueda web, retailer) |
| SHT31 | T, RH (mayor precisión que BME280) | I2C | USD 8–15 (típico) | No verificado con precio exacto en esta sesión |
| TSL2591 / BH1750 | Luz (lux, requiere calibración a PAR) | I2C | USD 5–10 | Conocimiento general; ver nota abajo sobre calibración |
| **Apogee SQ-500** | PAR/PPFD real (cuántico) | Analógico (0–40 mV) | **USD 416.12** | Verificado directamente en sitio del fabricante |
| MH-Z19B | CO₂ (NDIR, económico) | UART | USD 10–15 (típico) | No verificado con precio exacto; requiere calibración diaria según fuente citada en sección 1 |
| SCD30 | CO₂ (NDIR + compensación T/RH) | I2C | USD 50–60 (típico) | No verificado con precio exacto |
| SCD41 (chip crudo) | CO₂ (NDIR, rango extendido) | I2C | **USD ~20** | Verificado (DigiKey) |
| SCD41 (breakout/dev board) | ídem, con placa lista para prototipar | I2C | **USD 50–70** | Verificado (Adafruit, DigiKey, Arrow) |
| MLX90614 | Temperatura foliar sin contacto (punto único, para CWSI) | I2C | **USD 16.49** | Verificado (ShillehTek) |
| MLX90640 | Temperatura foliar/dosel (array 32×24, imagen térmica) | I2C | **USD 53–79** | Verificado (rango de mercado, varios retailers) |
| SC-1 Leaf Porometer | Conductancia estomática | Manual/portátil | No verificado — estimado USD 1,500–2,500 | Estimación de categoría de producto, sin cotización directa |
| FluorPen FP 110 | Fluorescencia Fv/Fm (PAM portátil) | Manual/portátil, USB/BT | No verificado — estimado USD 2,000–3,000 | Estimación de categoría de producto, sin cotización directa |

**Nota sobre BH1750/TSL2591 como proxy de PAR:** son sensores de luz visible ponderados a la percepción humana (lux), no a la fotosíntesis. Existe un método documentado (hobbyist, no arbitrado) para calibrar un BH1750 contra un sensor cuántico de referencia y aproximar PAR — ver [Cave Pearl Project](https://thecavepearlproject.org/2024/08/10/using-a-bh1750-lux-sensor-to-measure-par/). Es la opción de facto para mantener el costo bajo si el SQ-500 (USD 416) resulta inviable para el presupuesto de Totem — a costa de precisión y de un esfuerzo de calibración propio.

---

## 7. Actuadores adicionales por nivel

El diseño actual de Totem ya contempla bomba + aspersores + válvula NC (`modulo-actuacion.md`, `modulo-suministro.md`). Si se explora control activo de VPD u otras variables ambientales (niveles 2+), estos son los actuadores relevantes encontrados:

| Actuador | Propósito | Nota de costo/viabilidad |
|---|---|---|
| Nebulizador de baja potencia (mesh vibrante) | Subir humedad / bajar VPD sin gasto excesivo de agua | ~2 W por boquilla, 12 Wh/L vs. 250 Wh/L de ultrasónicos — compatible con diseño solar de bajo consumo. Ver [Micronice](https://aeroscience.info/dry-fog-applications/) |
| Boquilla aeropónica individual | Ya en uso en Totem (aspersión de raíz) | ~USD 30 por boquilla en acero inoxidable; boquillas de fibra de carbono ~75% más económicas según fuente comercial |
| Ventilador DC de bajo consumo | Bajar VPD por movimiento de aire / enfriar dosel | Componente genérico de bajo costo, no requiere fuente adicional |
| Deshumidificador/calentador activo | Control fino de VPD en ambientes cerrados | Fuera de alcance probable para Totem — pensado para invernadero cerrado, no para una unidad solar de exterior; no se investigó a fondo por baja relevancia al principio de bajo costo |

No se encontró información de costos de sistemas completos (solo componentes individuales) en las fuentes consultadas — dato pendiente si se decide avanzar con control activo de VPD.

---

## 8. Propuesta de niveles de firmware escalables

🔴 Esta sección es una **propuesta para discutir**, no una decisión — el repositorio no tenía previamente una definición formal de "niveles de firmware" fuera de la categoría "Rendimiento IoT/ML" de `evaluation-framework.md` (que evalúa versiones, pero no define su contenido). Se construye aquí como punto de partida.

La lógica: cada nivel debe ser **desplegable vía OTA sin cambio de hardware cuando sea posible**, y solo forzar una revisión física de unidad cuando el nivel introduce un sensor nuevo.

| Nivel | Lógica de decisión | Sensores requeridos (adicionales a T/RH/Li ya definidos) | Cambio de hardware | Complejidad de cómputo en ESP32 |
|---|---|---|---|---|
| **F0 — Baseline** | Temporizador fijo | Ninguno | No | Trivial |
| **F1 — Reglas ambientales** | Humedad de sustrato/raíz y/o VPD calculado desde T+RH, con umbrales por perfil de cultivo | Ninguno nuevo (usa T, RH ya definidos; humedad de raíz si se decide agregar) | No (o mínimo, si se agrega sensor de humedad) | Baja — fórmulas cerradas |
| **F2 — Pn por ML sin CO₂** | Modelo ML entrenado con T, RH, Li | Ninguno nuevo | No | Media — inferencia `.tflite` ya contemplada en el diseño |
| **F3 — Pn por ML con CO₂** (spec actual de `modulo-decision.md`) | Modelo ML entrenado con T, RH, Li, CO₂ | Sensor CO₂ NDIR | Sí — requiere el sensor de CO₂ y su mantenimiento de calibración | Media — mismo mecanismo de inferencia que F2 |
| **F4 — Pn + CWSI fusionado** | Modelo ML combinado con índice CWSI (temperatura foliar) como señal adicional o de validación cruzada | Sensor IR sin contacto (MLX90614) | Sí — requiere sensor IR apuntando al dosel | Media-alta — fusión de dos fuentes de señal |
| **F5 — Sensado fisiológico directo** | Fluorescencia, porometría, multiespectral, u otra combinación de la sección 5 | Variable según sensor elegido | Sí — hardware significativamente distinto | Alta — puede requerir preprocesamiento de imagen o señal antes de decisión |

**Por qué este orden:** F0→F2 no tocan hardware una vez fabricada la unidad — permiten iterar el modelo de decisión completo vía OTA mientras se define si el CO₂ vale la pena operativamente. F3 es el spec ya documentado en el proyecto. F4 introduce el sensor más barato y mejor validado de la sección 5 (MLX90614, ~USD 16, ya probado específicamente para CWSI) como paso intermedio de bajo riesgo antes de saltar a instrumentos de investigación (F5). F5 agrupa todo lo que hoy es caro, manual o poco maduro para una unidad autónoma de bajo costo — se deja abierto a qué sensor específico se explore primero, si se llega a esa etapa.

Esto también da una respuesta operativa al comentario del profesor: **no es necesario decidir "con CO₂ o sin CO₂" de forma binaria e inmediata.** F2 (sin CO₂) es implementable y desplegable ya, como primera versión productiva; F3 (con CO₂) queda como upgrade de precisión opcional para quien esté dispuesto a asumir el mantenimiento de calibración; F4 explora si CWSI puede compensar parte de la pérdida de precisión de no tener CO₂, con un sensor mucho más barato y de mantenimiento nulo comparado con NDIR.

---

## 9. Recomendación de ruta de experimentación (para discutir)

No es una decisión — son puntos de partida sugeridos por esta investigación para la conversación pendiente:

1. **Corto plazo:** validar F1 (VPD, ya calculable con T/RH existentes) como capa de seguridad/alerta, independientemente de qué nivel de ML se decida — es gratis en términos de hardware.
2. **Corto-medio plazo:** entrenar y comparar un modelo F2 (sin CO₂) contra uno F3 (con CO₂) sobre el mismo dataset si se consigue uno — esto llenaría directamente la brecha de investigación identificada en la sección 4.2 (no hay ablation study público comparable).
3. **Medio plazo:** evaluar el MLX90614 (F4) como complemento de bajo costo — es el sensor de la sección 5 con mejor relación evidencia/costo/madurez encontrada en esta investigación.
4. **Largo plazo / exploratorio:** multiespectral (sección 5.6) como posible sustituto de CO₂ a nivel de señal óptica, si el presupuesto y la capacidad de cómputo del ESP32 lo permiten en el futuro — probablemente requiera repensar dónde corre la inferencia (hoy fijado "en dispositivo" según `overview.md`).

---

## 10. Fuentes

### Papers científicos arbitrados (mayor solidez)

- Horticulturae 11(12):1475 — [A Photosynthetic Rate Prediction Model for Cucumber Based on a Machine Learning Algorithm and Multi-Factor Environmental Analysis](https://doi.org/10.3390/horticulturae11121475)
- Agriculture 13(1):204 — [A Cucumber Photosynthetic Rate Prediction Model in Whole Growth Period with Time Parameters](https://www.mdpi.com/2077-0472/13/1/204)
- Horticulturae 11(5):502 — [A Predictive Model of the Photosynthetic Rate of Chili Peppers Using Support Vector Regression and Environmental Multi-Factor Analysis](https://doi.org/10.3390/horticulturae11050502)
- IEEE Xplore — [Application of WDNN for Photosynthetic Rate Prediction in Greenhouse](https://ieeexplore.ieee.org/document/9389958)
- IJABE — [Model for tomato photosynthetic rate based on neural network with genetic algorithm](https://ijabe.org/index.php/ijabe/article/view/3127)
- IJABE — [Universality of an improved photosynthesis prediction model based on PSO-SVM at all growth stages of tomato](https://ijabe.org/index.php/ijabe/article/view/2580)
- Scientific Reports (Nature) — [A photosynthetic rate prediction model using improved RBF neural network](https://www.nature.com/articles/s41598-022-12932-9)
- PMC7012418 — [Machine learning models for net photosynthetic rate prediction using poplar leaf phenotype data](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7012418/)
- PMC11292552 — [Machine learning approaches for estimation of fAPAR and net photosynthesis rate of maize using multi-spectral sensor](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11292552/)
- PMC9905687 — [Retrieving rice net photosynthetic rate from UAV multispectral images based on machine learning methods](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9905687/)
- MDPI Sensors 24(17):5675 — [Low-Cost CO2 NDIR Sensors: Performance Evaluation and Calibration Using Machine Learning Techniques](https://www.mdpi.com/1424-8220/24/17/5675)
- PMC6463532 — [Evaluation and environmental correction of ambient CO2 measurements from a low-cost NDIR sensor](https://pmc.ncbi.nlm.nih.gov/articles/PMC6463532/)
- NIST — [Performance and Environmental Correction of a Low-Cost NDIR CO2 Sensor](https://www.nist.gov/publications/performance-and-environmental-correction-low-cost-ndir-co2-sensor)
- MDPI Sensors 21(6):2055 — [Low-Cost Chlorophyll Fluorescence Imaging for Stress Detection](https://www.mdpi.com/1424-8220/21/6/2055)
- AoB PLANTS 15(5):plad069 — [Tracking canopy chlorophyll fluorescence with a low-cost light emitting diode platform](https://academic.oup.com/aobpla/article/15/5/plad069/7320385)
- MDPI Sensors 24(1):25 — [A Smart Crop Water Stress Index-Based IoT Solution for Precision Irrigation of Wine Grape](https://www.mdpi.com/1424-8220/24/1/25)
- MDPI Sensors 23(3):1318 — [Water Stress Index Detection Using a Low-Cost Infrared Sensor and Excess Green Image Processing](https://www.mdpi.com/1424-8220/23/3/1318/xml)
- PMC8347285 — [Rapid Estimation of Crop Water Stress Index on Tomato Growth](https://pmc.ncbi.nlm.nih.gov/articles/PMC8347285/)
- ScienceDirect — [Machine learning-assisted implantable plant electrophysiology microneedle sensor for plant stress monitoring](https://www.sciencedirect.com/science/article/abs/pii/S0956566324010698)
- PubMed 25826257 — [Use of plant woody species electrical potential for irrigation scheduling](https://pubmed.ncbi.nlm.nih.gov/25826257/)
- ISHS — [Engineering a sap flow sensor for irrigators](https://ishs.org/ishs-article/991_8/)
- iScience (2026) — [Plant stress early detection through a low-cost multispectral device](https://www.cell.com/iscience/fulltext/S2589-0042(26)01644-5) — solo se pudo acceder al resumen/metadatos (fetch del texto completo bloqueado); pendiente revisión más profunda

### Preprints (aún no arbitrados — mencionar con reserva)

- arXiv:2512.22151 — [Machine Learning-Based Basil Yield Prediction in IoT-Enabled Indoor Vertical Hydroponic Farms](https://arxiv.org/pdf/2512.22151)

### Fuentes técnicas/gubernamentales (buena solidez, no arbitradas)

- Agriculture Victoria (gobierno de Australia) — [Plant-based sensors for irrigation management](https://agriculture.vic.gov.au/farm-management/water/irrigation/irrigation-factsheets-and-resources/Plant-based-sensors-for-irrigation.pdf)
- ExtensionAUS — [Plant based sensors for irrigation scheduling](https://extensionaus.com.au/irrigatingag/plant-based-sensors-for-irrigation-scheduling/)
- EPA (EE. UU.) — [Soil Moisture-Based Irrigation Controllers](https://www.epa.gov/watersense/soil-moisture-based-irrigation-controllers)
- Redalyc — [Plant electrophysiology: bibliometric analysis, methods and applications](https://www.redalyc.org/journal/496/49671325026/html/)

### Fuentes comerciales / de fabricante (para specs y precios — sesgo comercial esperable)

- Apogee Instruments — [SQ-500 Full-spectrum Quantum Sensor](https://www.apogeeinstruments.com/sq-500-ss-full-spectrum-quantum-sensor/) (precio verificado: USD 416.12)
- Sensirion — [SCD30](https://sensirion.com/products/catalog/SCD30), [SCD41](https://sensirion.com/products/catalog/SCD41)
- Winsen — [MH-Z19B datasheet](https://www.winsen-sensor.com/d/files/infrared-gas-sensor/mh-z19b-co2-ver1_0.pdf)
- METER Group — [SC-1 Leaf Porometer](https://metergroup.com/products/sc-1-leaf-porometer/)
- Photon Systems Instruments — [FluorPen & PAR FluorPen](https://handheld.psi.cz/products/fluorpen-and-par-fluorpen/)
- Melexis — [MLX90640 Far Infrared Thermal Sensor Array](https://www.melexis.com/en/product/MLX90640/Far-Infrared-Thermal-Sensor-Array)
- DigiKey, Adafruit, ShillehTek, Arrow, Future Electronics — precios de componentes (SCD41, MLX90614, BME280) verificados vía búsqueda de retailers múltiples

### Fuentes hobbyist/blog (menor solidez — usar con reserva, no como base de decisión)

- Cave Pearl Project — [Using a BH1750 Lux Sensor to Measure PAR](https://thecavepearlproject.org/2024/08/10/using-a-bh1750-lux-sensor-to-measure-par/)
- Andrey Ovcharov — [Comparing MH-Z19B and SCD41](https://en.ovcharov.me/2025/02/19/comparing-mh-z19b-and-scd41-building-a-smarter-co-monitor/)
- CanAirIO — [CO2 Sensors Comparative](https://canair.io/docs/co2_comparative.html)
- AeroScience / Micronice — [Dry Fog Applications](https://aeroscience.info/dry-fog-applications/) (fuente comercial de fabricante de nebulizadores)
- Tekceleo — [Foggers for Aeroponics Systems](https://www.tekceleo.com/aeroponics-systems/) (fuente comercial)

---

## Documentos relacionados

- `modulo-decision.md` — decisiones pendientes OI-IRR-01 a OI-IRR-05 que este documento busca informar, no reemplazar
- `modulo-lectura-sensores.md` — selección de sensores físicos, aún pendiente
- `../../../transversal/crop-profile.md` — el umbral de Pn/variable de decisión depende de qué nivel de firmware se adopte
- `../../../evaluation-framework.md` — categoría "Rendimiento IoT/ML" evalúa precisión de predicción; los niveles aquí propuestos le darían contenido concreto a esa evaluación por versión
