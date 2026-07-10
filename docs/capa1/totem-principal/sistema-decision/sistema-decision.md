# Sistema de Decisión de Riego

Determina cuándo y por cuánto tiempo regar. No ejecuta el riego — esa es responsabilidad del [Sistema de Riego](../sistema-riego/sistema-riego.md).

## Módulos

| Módulo | Responsabilidad |
|---|---|
| [Módulo de Lectura de Sensores](modulo-lectura-sensores.md) | Lee T, RH, Li y los traduce a valores utilizables |
| [Módulo de Decisión](modulo-decision.md) | Calcula VPD (T, RH) y decide si activar riego y por cuánto tiempo, con Li como modulador de duración |

## Flujo

```
Sensores → Módulo de Lectura → [T, RH, Li]
         → Módulo de Decisión → lee Perfil de Cultivo Activo
         → VPD ≥ umbral → señal de riego + duración (modulada por Li)
```

CO₂ fue evaluado y descartado del conjunto de sensores — ver decisión del 10 jul 2026 en `modulo-decision.md`.

El Módulo de Lectura puede probarse y desarrollarse de forma independiente.
El Módulo de Decisión puede simularse con lecturas sintéticas.
