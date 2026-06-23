# Sistema de Decisión de Riego

Determina cuándo y por cuánto tiempo regar. No ejecuta el riego — esa es responsabilidad del [Sistema de Riego](../sistema-riego/sistema-riego.md).

## Módulos

| Módulo | Responsabilidad |
|---|---|
| [Módulo de Lectura de Sensores](modulo-lectura-sensores.md) | Lee T, RH, Li, CO₂ y los traduce a valores utilizables |
| [Módulo de Decisión](modulo-decision.md) | Estima Pn con ML y decide si activar riego y por cuánto tiempo |

## Flujo

```
Sensores → Módulo de Lectura → [T, RH, Li, CO₂]
         → Módulo de Decisión → lee Perfil de Cultivo Activo
         → Pn < umbral → señal de riego + duración
```

El Módulo de Lectura puede probarse y desarrollarse de forma independiente.
El Módulo de Decisión puede simularse con lecturas sintéticas.
