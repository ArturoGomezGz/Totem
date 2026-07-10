# Módulo de Suministro

Responsabilidad: asegurar que el tanque del Totem tenga suficiente solución nutritiva antes de regar, manteniendo un nivel promedio — no un rango de alta precisión.

**Decisión — 9 jul 2026 (revisa la decisión anterior del 22 jun 2026 de usar dos flotadores, ver `ecosistema/overview.md`).** Se simplifica a **un solo flotador**. Razón: la válvula solo necesita una decisión local de abrir/cerrar, el nivel del Totem no se reporta a Capa 2 (no hay beneficio de telemetría en tener más granularidad), y mantener un nivel aproximado es suficiente para el riego. Contraste con el tanque padre (`tanque-de-suministro/modulo-flotadores.md`), que sí usa 3 flotadores porque ahí el nivel se reporta como serie de tiempo.

## Comportamiento

| Flotador | Estado | Acción |
|---|---|---|
| Sumergido | Nivel suficiente | Válvula cerrada, LED verde |
| En aire | Nivel bajo | Válvula abierta, LED rojo, alerta a Capa 2 |

## Control de válvula NC

La válvula solenoide es normalmente cerrada (NC):
- Se **abre** cuando el flotador queda en el aire (nivel bajo)
- Se **cierra** cuando el flotador vuelve a quedar sumergido (nivel recuperado)
- Sin corriente (fallo del ESP32): permanece cerrada — **falla segura por diseño**

La fuente del otro lado de la válvula es transparente para este módulo: puede ser el [Sistema de Solución Nutritiva](../../solucion-nutritiva/sistema-solucion-nutritiva.md), una llave de agua o cualquier fuente con presión positiva.

**Riesgo a validar en hardware:** sin banda de histéresis (dos umbrales separados, como en el diseño anterior), existe el riesgo teórico de que la válvula "castañee" si el nivel oscila justo en el punto del flotador durante el llenado. Se espera que esto no ocurra en la práctica porque el llenado por gravedad es rápido (el nivel se aleja pronto del punto del flotador) mientras que el consumo por riego es lento y gradual, pero queda pendiente de confirmar en un prototipo real.

## Verificación antes de regar

Antes de habilitar el [Módulo de Actuación](modulo-actuacion.md):
1. ¿El flotador está sumergido? → proceder con el riego
2. ¿El flotador está en el aire? → abrir válvula, esperar llenado, luego proceder

## Indicadores físicos

- **LED rojo** — flotador en el aire (nivel bajo)
- **LED verde** — flotador sumergido (nivel suficiente)

## Independencia

Puede desarrollarse y probarse de forma independiente al resto del sistema.

## Documentos relacionados

- `ecosistema/overview.md` — decisión: válvula NC, flotadores, LEDs
- `requirements.md` — FR-39 a FR-42
- `solucion-nutritiva/sistema-solucion-nutritiva.md` — la fuente que puede estar del otro lado de la válvula
