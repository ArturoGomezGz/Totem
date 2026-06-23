# Módulo de Suministro

Responsabilidad: asegurar que el tanque del Totem tenga suficiente solución nutritiva antes de regar, y mantener el nivel dentro del rango operativo.

## Comportamiento

| Flotador 90% | Flotador 30% | Estado | Acción |
|---|---|---|---|
| Sumergido | Sumergido | Lleno (> 90%) | Válvula cerrada, LED verde |
| En aire | Sumergido | Normal (30–90%) | Sin acción |
| En aire | En aire | Bajo (< 30%) | Válvula abierta, LED rojo, alerta a Capa 2 |

## Control de válvula NC

La válvula solenoide es normalmente cerrada (NC):
- Se **abre** cuando el flotador del 30% queda en el aire (nivel bajo)
- Se **cierra** cuando el flotador del 90% se activa (tanque lleno)
- Sin corriente (fallo del ESP32): permanece cerrada — **falla segura por diseño**

La fuente del otro lado de la válvula es transparente para este módulo: puede ser el [Sistema de Solución Nutritiva](../../solucion-nutritiva/sistema-solucion-nutritiva.md), una llave de agua o cualquier fuente con presión positiva.

## Verificación antes de regar

Antes de habilitar el [Módulo de Actuación](modulo-actuacion.md):
1. ¿El flotador del 30% está sumergido? → proceder con el riego
2. ¿El flotador del 30% está en el aire? → abrir válvula, esperar llenado, luego proceder

## Indicadores físicos

- **LED rojo** — flotador del 30% en el aire (nivel bajo)
- **LED verde** — flotador del 90% sumergido (tanque lleno)

## Independencia

Puede desarrollarse y probarse de forma independiente al resto del sistema.

## Documentos relacionados

- `ecosistema/overview.md` — decisión: válvula NC, flotadores, LEDs
- `requirements.md` — FR-39 a FR-42
- `solucion-nutritiva/sistema-solucion-nutritiva.md` — la fuente que puede estar del otro lado de la válvula
