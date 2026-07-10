# Sistema de Abastecimiento por Gravedad

**Estado:** concepto — pendiente de formalizar como proyecto. **No forma parte del MVP de Totem.** Compatible por diseño con la Capa 1 sin cambios de código.

---

## Idea central

Un tanque padre elevado físicamente por encima del tanque del Totem abastece agua por gravedad. No se necesita bomba en el tanque padre — la diferencia de altura genera la presión suficiente. El Totem controla su propia entrada de agua mediante la válvula solenoide NC ya instalada en su tubería de entrada (FR-39).

Esto elimina un componente activo completo del sistema y reduce la integración física a conectar una manguera.

---

## Diagrama conceptual

```
[Tanque padre — elevado]
        │  3 flotadores (nivel granular, reportado a Capa 2)
        │
        │  gravedad / presión estática
        │
        ▼
  [Válvula NC] ←── controlada por ESP32 del Totem
        │
        ▼
  [Tanque Totem]
        │
        └── 1 flotador (control local de válvula, no se reporta)
```

---

## Comportamiento de la válvula NC (tanque hijo / Totem)

**Decisión — 9 jul 2026 (revisa la decisión anterior del 22 jun 2026, ver `ecosistema/overview.md`).** El tanque del Totem usa **un solo flotador**, no dos. Razón: la válvula solo necesita una decisión local de abrir/cerrar para mantener un nivel promedio suficiente — no se busca precisión, y el nivel del Totem no se reporta a Capa 2 (ver nota de diseño en `capa2/schema.md`), así que no hay necesidad de granularidad adicional para telemetría.

| Condición | Estado válvula | Resultado |
|---|---|---|
| ESP32 activo, flotador en aire (nivel bajo) | Abierta (energizada) | Llenado normal |
| ESP32 activo, flotador sumergido (nivel suficiente) | Cerrada | Llenado se detiene |
| ESP32 cuelga o pierde corriente | Cerrada (estado natural) | No puede desbordarse |
| Fallo de software o WiFi | Cerrada (estado natural) | Falla segura por diseño |

El desbordamiento requeriría un fallo activo (válvula forzada abierta), no pasivo. La válvula NC solo consume corriente cuando está abierta — en operación normal el consumo es cero, ideal para un sistema solar.

**Riesgo a validar en prototipo:** con un solo flotador (sin banda de histéresis entre dos umbrales, a diferencia del diseño anterior de 30%/90%) existe la posibilidad teórica de que la válvula "castañee" (abra/cierre repetidamente) si el nivel oscila justo en el punto del flotador durante el llenado. En la práctica esto se mitiga porque el llenado por gravedad es rápido una vez abierta la válvula (el nivel sube rápido y se aleja del punto del flotador) mientras que el consumo por riego es lento y gradual — pero conviene confirmarlo en hardware real antes de darlo por cerrado.

---

## Comportamiento en el MVP (llenado manual)

En el MVP no existe tanque padre — el usuario recarga el tanque manualmente. La válvula solenoide y los flotadores funcionan igual con llenado manual. La válvula puede instalarse en el MVP como preparación para la integración futura sin ningún cambio posterior en hardware o firmware.

---

## Tanque padre como sistema independiente (fase futura)

El tanque padre es un sistema autónomo, no una extensión del Totem.

**Responsabilidades del tanque padre:**
- Monitorear su propio nivel de agua
- Medir calidad del agua: pH y EC (ver "Variables de calidad de agua — MVP" abajo)
- Alertar cuando su nivel sea bajo (requiere recarga humana)
- Estar físicamente elevado sobre el nivel del Totem

**Lo que NO hace:**
- No controla cuándo llenar el Totem — esa responsabilidad es del Totem via la válvula NC
- No tiene bomba
- No necesita conocer el estado interno del Totem

**Implementación:** el tanque padre correría en su propio ESP32 y se registraría como una unidad adicional en el mismo sistema — misma API, mismo dashboard. Sin cambios de firmware ni de API en el Totem.

### Relación tanque padre ↔ totems que abastece

**Decisión — 9 jul 2026.** `totem_configs.supply_tank_id` (nullable, FK → `units`) vincula cada Totem con el tanque padre del que se abastece. Es una relación **1 tanque → N totems** (no many-to-many): físicamente un Totem se abastece de un tanque a la vez, así que no se necesita tabla pivote. Ver `capa2/schema.md` para el detalle del campo y sus constraints.

**Es puramente informativa para el dashboard** ("este tanque abastece a estos N totems" / "este Totem se abastece de este tanque") — no cambia el comportamiento físico de ninguno de los dos lados. El Totem sigue decidiendo su propio llenado vía su flotador y válvula NC sin depender de que el server conozca esta relación, consistente con el principio de independencia ya establecido arriba.

---

## Ventajas frente a bomba en tanque padre

| Dimensión | Bomba en tanque padre | Gravedad + válvula NC |
|---|---|---|
| Componentes | Bomba + válvula o flotador de corte | Solo válvula NC en el Totem |
| Puntos de fallo | Motor, impeller, control de bomba | Solo la válvula |
| Consumo energético | Bomba activa durante el llenado | Solo válvula NC durante el llenado |
| Ruido | Sí (motor) | No |
| Seguridad ante fallo | Requiere mecanismo de corte adicional | NC = falla segura por diseño |
| Costo | Bomba + válvula / flotador | Solo válvula NC |
| Replicabilidad | Moderada | Alta |

**Condición de instalación:** el tanque padre debe estar elevado al menos unos centímetros por encima del nivel máximo del tanque Totem para garantizar presión positiva. A mayor altura, mayor caudal. Variable de instalación — sin implicaciones en firmware ni API.

---

## Diseño físico propuesto (borrador)

Tubo PVC del mismo diámetro que el tanque del Totem, aprovechando la misma altura de este (no requiere elevar el tanque completo — el tanque padre gana altura propia por ser un tubo alto). Salida de agua ubicada un par de cm por encima de la entrada del tanque hijo (Totem), para garantizar presión positiva constante.

**Nota:** el diámetro y la altura exactos del tubo del Totem no están documentados en ningún lugar del repo — son datos pendientes de definir/medir antes de dimensionar sensores de nivel (ver más abajo).

### Medición de nivel — opciones evaluadas

| Opción | Pros | Contras para este diseño |
|---|---|---|
| Flotadores digitales (elegido) | Mismo principio ya usado y validado en el Totem, barato, robusto, sin electrónica de medición analógica que calibrar | Nivel discreto (por escalón), no continuo — la resolución depende de cuántos flotadores se instalen |
| Ultrasónico impermeable (JSN-SR04T) | Barato, sin contacto | El cono de emisión (~15–50° según modelo) puede rebotar contra las paredes del tubo antes de llegar al agua si el tubo es angosto respecto a la distancia de medición (multipath / ecos falsos). Rango útil típico ~20–25 cm (zona muerta) a 4–6 m |
| Time-of-Flight láser (VL53L0X/L1X) | Haz mucho más estrecho que ultrasónico — mucho menos rebote en tubos angostos | Requiere ventana sellada frente al sensor por la humedad/condensación; rango más corto (~2–4 m) |
| Capacitivo no invasivo (tipo XKC-Y25-V), montado por fuera del tubo | No toca el líquido, inmune a lo que pase en el fondo del tanque, instalación simple (se abraza al tubo) | Da un umbral discreto por sensor, no nivel continuo — necesitaría varios a distintas alturas para más resolución |
| Presión hidrostática sumergida | Preciso y continuo | Contacto directo con la solución (corrosión, fouling); vive en el fondo, la zona más expuesta a residuos — mayor riesgo de deriva con el tiempo |

**Decisión — 9 jul 2026.** Se descartan los sensores continuos/no invasivos de la tabla — el sistema usará **flotadores digitales** en ambos tanques, consistente con lo ya validado en el Totem:

- **Tanque padre**: 3 flotadores digitales (en vez de los 2 del Totem) para un cálculo de nivel más granular, ya que aquí sí interesa tener datos concretos para la serie de tiempo reportada a Capa 2 (ver `modulo-flotadores.md`).
- **Tanque hijo (Totem)**: 1 flotador — suficiente para mantener un nivel promedio y decidir apertura/cierre de la válvula localmente; no requiere precisión porque no se reporta a Capa 2 (ver sección de válvula NC arriba).

### Variables de calidad de agua — MVP

**Decisión — 9 jul 2026.** El MVP del tanque padre mide **pH y EC**. Temperatura del agua queda **fuera del MVP por ahora** — se puede agregar después sin cambios de esquema (columna nullable adicional en `readings`, mismo patrón que el resto de sensores).

Razonamiento: EC y pH son las dos variables que determinan si la solución es apta para el cultivo (concentración de nutrientes y disponibilidad de absorción, respectivamente) — ambas son bloqueantes de valor si fallan. La temperatura del agua es menos crítica como alerta independiente y muchos sensores de EC de bajo costo ya traen compensación de temperatura integrada, por lo que no es indispensable exponerla como variable propia en esta primera versión.

### Homogeneidad de la solución nutritiva (estratificación vs. sedimento)

Investigación (jul 2026) sobre si la solución nutritiva requiere agitación para mantenerse homogénea en un tanque en reposo, y si eso afecta la medición de calidad (pH/EC):

Hay dos fenómenos distintos que conviene no confundir:

1. **Partículas no disueltas** (sedimento propiamente dicho): si algún componente no quedó completamente disuelto al preparar la solución (común si se mezclan concentrados de Ca y de fosfato/sulfato sin diluir primero — precipitación/"lock-out", un problema clásico y documentado en hidroponía), esas partículas sedimentan por gravedad en minutos a horas. Se evita con buena práctica de mezclado, no es un fenómeno físico inevitable.

2. **Estratificación por densidad de la solución ya disuelta**: una solución de sales completamente disueltas no sedimenta como partículas (son iones), pero sí puede estratificar por gradientes térmicos — agua más fría y densa se va al fondo, agua más caliente queda arriba, con diferencias de EC medibles entre capas. Según física de difusión molecular pura (sin flujo), homogenizar 1 mm toma ~5 min pero 1 cm toma ~500 min (~8 h); en tanques de laboratorio con estratificación salina controlada, una zona de transición delgada (3–4 cm) tarda 2–3 h en difundirse y una más gruesa (7–8 cm) requiere ~18 h adicionales. La homogenización completa por difusión pasiva (sin mezcla mecánica) se estima en **horas a días**, no minutos — ver fuentes.

**Relevancia para este diseño:** un tubo alto y angosto expuesto al sol es geométricamente el peor caso para estratificación térmica (favorece el gradiente vertical y tiene poca convección lateral natural que lo rompa, a diferencia de un tanque ancho y bajo). Los sistemas hidropónicos/aeropónicos activos resuelven esto con air stones o bombas de recirculación — algo que este diseño evita deliberadamente por ser pasivo/solar.

**Mitigación propuesta (sin romper el diseño pasivo):**
- Ubicar el sensor de calidad (pH/EC) a la misma altura que la salida de agua, no en un punto arbitrario — así se mide lo que realmente se entrega al Totem, sin que importe si hay una capa distinta arriba o en el fondo que nunca sale del tanque.
- Mitigar el gradiente térmico en el diseño físico (tubo pintado de blanco/reflectante o aislado) en vez de resolverlo con electrónica o agitación activa.
- Buena práctica de preparación de solución (disolver bien, no mezclar concentrados sin diluir) para evitar sedimento de partículas no disueltas.
- Validar empíricamente en un prototipo real: comparar EC/pH arriba vs. en la salida tras distintos tiempos de reposo (1h, 6h, 24h) — la literatura no da números exactos para esta geometría específica (tubo angosto tipo Totem).

**Fuentes:**
- [Stratified water columns: homogenization and interface evolution — Scientific Reports](https://www.nature.com/articles/s41598-024-62035-w)
- [Experiment: Influence of stratification on mixing — Adventures in Oceanography and Teaching](https://mirjamglessmer.com/2018/08/01/experiment-influence-of-stratification-on-mixing/)
- [MAKE A SALT STRATIFICATION — University of Colorado](https://storm.colorado.edu/TeachingandLearning/Facillities/SaltStratification/SaltStratification.htm)
- [Understanding EC in Hydroponic Systems — Emerald Harvest](https://emeraldharvest.co/understanding-ec-in-hydroponic-systems/)
- [Hydroponic Air Pumps and Air Stones: Beginner Guide to Oxygenation — HydroGardenLab](https://hydrogardenlab.com/hydroponic-air-pump-and-air-stones/)

### Rangos objetivo de pH/EC — ¿propios del tanque o derivados del perfil de cultivo?

Investigación (jul 2026) sobre cuánto varían los rangos de pH/EC entre distintos cultivos en hidroponía/aeroponía, para decidir si el tanque padre puede heredar su rango objetivo de los perfiles de cultivo de los totems que abastece.

**pH — bastante uniforme entre cultivos.** La mayoría cae en 5.5–6.5 (hoja verde/hierbas ~5.5–6.2, frutales ~6.0–6.5) — hay suficiente superposición para que un solo rango sea razonable en casi cualquier combinación de cultivos.

**EC — varía significativamente y no es un matiz menor.** Hoja verde ~0.8–1.2 mS/cm, hierbas ~1.0–1.6, fresa ~1.0–2.5, frutales (tomate/pimiento) ~2.0–3.5 mS/cm — hasta ~3x de diferencia entre hoja verde y frutales, sin solapamiento entre los extremos. Incluso dentro del mismo cultivo, la EC objetivo cambia por etapa de crecimiento.

**Decisión — 9 jul 2026.** `supply_tank_configs.ec_min/max` y `ph_min/max` son **manuales, explícitos por tanque (Opción A)** — no se derivan automáticamente de los perfiles de cultivo de los totems conectados. Razón reforzada por la investigación: si un tanque abastece cultivos con EC objetivo muy distinto (ej. hoja verde + frutales), no existe un único rango "correcto" derivable — la composición real de la solución determina qué cultivos puede alimentar ese tanque, no al revés. El Totem no tiene forma de ajustar la concentración por sí mismo (solo controla cuándo abrir la válvula de agua), así que mezclar cultivos incompatibles bajo un mismo tanque es una decisión operativa del usuario, no algo que el sistema pueda resolver automáticamente.

**No se descarta un cálculo automático de *sugerencia*** a futuro (a partir de los perfiles conectados, con detección explícita de incompatibilidad si los rangos no se solapan) — diseño completo documentado como feature planificada en `docs/planned-features.md` § "Cálculo automático de rango EC/pH sugerido", pensado como módulo que vive sobre el esquema ya cerrado, sin modificarlo.

**Fuentes:**
- [Hydroponic lettuce EC & pH chart — Urban Harvest Lab](https://urbanharvestlab.com/blog/hydroponics/hydroponic-lettuce-ec-ph-chart/)
- [How to grow hydroponic basil: EC, pH, and light — Urban Harvest Lab](https://urbanharvestlab.com/blog/hydroponics/hydroponic-basil-ec-ph-light/)
- [Best pH and EC Values for Hydroponics (Chart) — ShesHeGrows](https://shershegrows.com/hydroponic-ph-and-ec-chart/)
- [Hydroponics vs. Soil: Ideal pH and EC Levels for Common Fruits and Veg — Quality Plants & Seedlings](https://www.qpseedlings.com.au/blogs/news/hydroponics-vs-soil-ideal-ph-and-ec-levels-for-common-fruits-and-veggies)
- [Optimal EC Levels for Hydroponic Vegetables — Quality Plants & Seedlings](https://www.qpseedlings.com.au/blogs/news/optimal-ec-levels-for-hydroponic-vegetables)
- [PPM & EC Benchmarks for Each Grow Phase — Humboldt's Secret Supplies](https://humboldtssecretsupplies.com/blogs/articles/ppm-ec-benchmarks-for-each-grow-phase)

---

## Decisiones pendientes

- Modelo específico de válvula solenoide NC (voltaje, caudal máximo, presión, materiales en contacto con agua)
- Altura mínima de instalación del tanque padre para caudal suficiente
- Diámetro y altura reales del tubo PVC del Totem (no documentados aún) — necesarios para ubicar los 3 flotadores del tanque padre a alturas proporcionales
- Alturas exactas de los 3 flotadores del tanque padre (porcentaje de capacidad cada uno)
- Modelo/parte específica de sensores de pH y EC (rango, costo, calibración) — variables ya cerradas (ver arriba), falta elegir hardware
- Ubicación exacta de los sensores de pH/EC respecto a la salida de agua
- Validación empírica de estratificación térmica en un prototipo real (ver sección de homogeneidad arriba)
- Validación en hardware real del riesgo de "castañeo" de la válvula con un solo flotador en el tanque hijo (ver nota en la sección de válvula NC)
- Capacidad del tanque padre en función del consumo del Totem (informa `supply_tank_configs.capacity_liters`)
- Valores concretos de `ph_min/max` y `ec_min/max` por instalación — el mecanismo es manual (ver arriba), falta que cada usuario los defina según su cultivo real
- (Futuro, no bloqueante) extender `crop_profiles` con `ec_min/max` y `ph_min/max` nullable si se implementa el módulo de sugerencia automática — ver `docs/planned-features.md`

---

## Documentos relacionados

- `docs/requirements.md` — FR-39 a FR-42 (válvula NC y flotadores, parte del MVP)
- `docs/planned-features.md` — referenciado como feature futura
- `docs/ecosistema/overview.md` — comportamiento del sistema de nivel de tanque en Capa 1
- `docs/capa2/schema.md` — campo `totem_configs.supply_tank_id` y sus constraints de integridad
