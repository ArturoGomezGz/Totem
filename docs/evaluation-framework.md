# Marco de Evaluación del Sistema

Marco estructurado para puntuar y comparar versiones del sistema Totem a lo largo de iteraciones sucesivas de desarrollo. Permite medir el progreso entre versiones de forma objetiva y consistente.

**Puntuación total = Σ (Puntuación de categoría × Peso de categoría)**

Escala: 0 a 10 por categoría y subcategoría.

🔴 **Pendiente:** las escalas de puntuación para cada subcategoría no han sido definidas. Falta definir los anclajes (qué representa un 1, un 5 y un 10 para cada métrica) y si la puntuación es absoluta o relativa a una versión de referencia.

---

## 1. Costo — 25%

Evalúa qué tan económico es construir y operar una unidad. El costo es la restricción más dura del proyecto: un sistema costoso no puede replicarse a escala independientemente de su desempeño técnico.

- **CapEx por unidad** — costo total de construcción: materiales físicos (tubería PVC, conexiones, depósito), componentes electrónicos (ESP32, sensores, bomba, batería) y mano de obra de ensamble
- **OpEx mensual** — costo operativo continuo: consumo eléctrico, agua, solución nutritiva, mantenimiento rutinario de piezas
- **Costo por kg producido** — (CapEx amortizado + OpEx) / kg cosechados por mes. Permite comparación directa contra agricultura convencional e hidropónica comercial
- **Costo marginal de escala** — costo incremental de agregar una unidad adicional; idealmente decrece con economías de escala en materiales y ensamble

---

## 2. Replicabilidad y diseño — 25%

Evalúa qué tan fácilmente puede reproducirse, expandirse y mantenerse el sistema. Es la propuesta de valor central del proyecto: un sistema que no pueda ser replicado por otros falla en su objetivo principal.

- **Disponibilidad local de materiales** — facilidad de obtener todos los componentes en el mercado local sin importaciones ni proveedores especializados; mayor disponibilidad = mayor replicabilidad entre regiones
- **Tiempo de ensamble por unidad** — horas totales para construir una unidad desde cero; refleja complejidad del diseño y accesibilidad para personas sin formación técnica avanzada
- **Componentes estándar vs. especializados** — proporción de piezas genéricas (PVC estándar, ESP32) frente a componentes únicos; mayor proporción estándar reduce la dependencia de la cadena de suministro
- **Documentación de replicación** — si una persona externa sin conocimiento previo puede construir una unidad con éxito siguiendo solo la documentación disponible
- **Unidades por controlador** — número máximo de unidades que un ESP32 puede gestionar sin degradación de rendimiento
- **Degradación de rendimiento a escala** — cómo cambia el comportamiento al agregar unidades; un sistema bien diseñado escala linealmente sin pérdida significativa

---

## 3. Eficiencia de recursos — 20%

Evalúa qué tan eficientemente usa el sistema sus insumos principales: agua, energía y nutrientes. Es la categoría más extensamente documentada en la literatura, lo que permite comparación directa contra estándares establecidos.

- **WUE — Eficiencia de uso del agua** — gramos de biomasa por litro de agua consumida (g/L). Los sistemas aeropónicos logran un ahorro del 90–98% frente a la agricultura convencional.
- **Consumo energético** — kWh por kg cosechado; incluye bomba, sensores, microcontrolador e iluminación artificial donde aplica
- **Consumo de nutrientes** — mg de nutriente por g de planta producida; se estima via variación de EC en el reservorio combinada con lecturas del nivel de solución
- **Desperdicio de solución nutritiva** — % de solución no absorbida ni recirculada; en un sistema bien diseñado se aproxima a cero

---

## 4. Salud del cultivo — 20%

Evalúa el resultado final: estado de las plantas y rendimiento de cosecha. Valida que todo lo demás está funcionando correctamente. Ninguna otra métrica importa si las plantas no están sanas y productivas.

- **Tasa de crecimiento semanal** — incremento promedio en altura o masa foliar por semana (cm/semana o g/semana)
- **Uniformidad entre plantas** — grado de similitud entre plantas de la misma unidad en tamaño, color y etapa de desarrollo; alta uniformidad indica distribución homogénea de nutrientes y condiciones estables
- **Tasa de mortalidad y estrés visible** — % de plantas que mueren o exhiben síntomas de estrés (amarillamiento, marchitamiento, necrosis) durante un ciclo de cultivo
- **Rendimiento por m²** — kg cosechados por metro cuadrado de huella del sistema (kg/m²); métrica estándar para comparar sistemas de cultivo vertical frente a agricultura convencional

---

## 5. Rendimiento IoT/ML — 10%

Evalúa la calidad técnica del sistema inteligente. Tiene menos peso en la etapa actual ya que la capa inteligente está en desarrollo, pero se vuelve cada vez más central en versiones futuras.

- **Latencia sensor-a-acción** — ms desde la lectura del sensor hasta la actuación de la bomba; crítica en aeroponía donde las raíces expuestas pueden sufrir daño en minutos
- **Precisión del cálculo de riego** — desviación entre el VPD objetivo del perfil y el VPD real mantenido en la cámara aeropónica
- **Tiempo de actividad del sistema** — % del tiempo que el sistema opera sin fallas; una falla de riego aeropónico puede causar daño irreversible en raíces en pocas horas
- **Cobertura de sensores por unidad** — número y variedad de variables monitoreadas (T, RH, Li, EC, pH, nivel, caudal); mayor cobertura habilita mejores alertas y análisis histórico
