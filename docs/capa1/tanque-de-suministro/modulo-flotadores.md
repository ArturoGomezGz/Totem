# Módulo de Flotadores

Responsabilidad: monitorear el nivel de solución nutritiva disponible en el tanque padre y reportarlo a la Capa 2.

## Sensores

Dos flotadores digitales montados en el tanque padre:
- **Flotador bajo** — umbral mínimo de solución disponible (nivel a definir)
- **Flotador alto** — tanque lleno (nivel a definir)

## Comportamiento

| Flotador alto | Flotador bajo | Estado | Acción |
|---|---|---|---|
| Sumergido | Sumergido | Lleno | Reporta nivel a Capa 2 |
| En aire | Sumergido | Normal | Sin acción |
| En aire | En aire | Bajo | Alerta a Capa 2 — requiere recarga humana |

## Independencia

El tanque de suministro no controla cuándo llenar el Totem — esa decisión es del [Módulo de Suministro](../totem-principal/sistema-riego/modulo-suministro.md) de cada Totem via su válvula NC. Este módulo solo cuida el nivel de la fuente.

## Pendientes

🔴 Niveles exactos de los flotadores (porcentaje de capacidad del tanque padre).
🔴 Sensores de calidad de solución: pH, EC, temperatura — por definir si van en el MVP del tanque de suministro.
