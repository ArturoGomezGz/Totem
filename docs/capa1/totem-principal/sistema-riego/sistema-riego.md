# Sistema de Riego

Ejecuta el riego cuando el [Sistema de Decisión](../sistema-decision/sistema-decision.md) lo indica. No decide cuándo regar — solo cómo.

## Módulos

| Módulo | Responsabilidad |
|---|---|
| [Módulo de Suministro](modulo-suministro.md) | Verifica que haya suficiente solución en el tanque; controla la válvula NC |
| [Módulo de Actuación](modulo-actuacion.md) | Enciende y apaga la bomba; controla los aspersores |

## Flujo

```
Señal de riego + duración (del Sistema de Decisión)
  → Módulo de Suministro: ¿hay suficiente solución?
      → Sí → Módulo de Actuación: enciende bomba (duración indicada)
      → No → abre válvula NC → espera llenado → Módulo de Actuación
```

## Independencia

Puede desarrollarse y probarse sin el Sistema de Decisión — basta con simular la señal de entrada. El Módulo de Suministro no sabe qué hay del otro lado de la válvula (tanque padre, llave, manguera) — eso es transparente por diseño.
