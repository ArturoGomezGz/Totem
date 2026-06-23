# Módulo de Actuación

Responsabilidad: encender y apagar la bomba de riego según la señal recibida del [Sistema de Decisión](../sistema-decision/sistema-decision.md), una vez que el [Módulo de Suministro](modulo-suministro.md) ha confirmado que hay solución disponible.

## Comportamiento

- Recibe: señal de riego + duración en segundos
- Ejecuta: enciende bomba → espera duración → apaga bomba
- Registra: evento ON/OFF con timestamp y duración en buffer local

## Triggers

| Origen | Tipo |
|---|---|
| Sistema de Decisión de Riego | `autonomous` |
| Comando de override desde Capa 2 | `override` |

## Pendientes

🔴 Mecanismo de detección de fallo de bomba (FR-11) — qué hacer si la bomba no responde tras activarse.
