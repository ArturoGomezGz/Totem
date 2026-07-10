# Módulo de Flotadores

Responsabilidad: monitorear el nivel de solución nutritiva disponible en el tanque padre y reportarlo a la Capa 2 como serie de tiempo.

## Sensores

**Decisión — 9 jul 2026.** Tres flotadores digitales montados en el tanque padre (uno más que en el Totem) — la granularidad adicional se justifica porque, a diferencia del tanque del Totem, el nivel del tanque padre **sí se reporta a Capa 2** (ver `capa2/schema.md` § "Extensión para el tanque de suministro") y se grafica como histórico, no solo se usa para una decisión local de apertura/cierre de válvula:

- **Flotador bajo** — umbral mínimo de solución disponible, requiere recarga humana (nivel a definir)
- **Flotador medio** — nivel intermedio, referencia de consumo (nivel a definir)
- **Flotador alto** — tanque lleno (nivel a definir)

Cada flotador es un sensor todo-o-nada; la combinación de los tres da un nivel discreto en 4 escalones (vacío / bajo / medio / lleno), no un valor continuo. El campo `tank_level` en `readings` (cuando se agregue, ver `capa2/schema.md`) almacena ese valor discreto en cada publicación o cambio de estado — es una serie de tiempo de una variable escalonada, no una curva suave.

## Comportamiento

| Flotador alto | Flotador medio | Flotador bajo | Estado | Acción |
|---|---|---|---|---|
| Sumergido | Sumergido | Sumergido | Lleno | Reporta nivel a Capa 2 |
| En aire | Sumergido | Sumergido | Medio-alto | Reporta nivel a Capa 2 |
| En aire | En aire | Sumergido | Medio-bajo | Reporta nivel a Capa 2 |
| En aire | En aire | En aire | Bajo | Alerta a Capa 2 — requiere recarga humana |

## Independencia

El tanque de suministro no controla cuándo llenar el Totem — esa decisión es del [Módulo de Suministro](../totem-principal/sistema-riego/modulo-suministro.md) de cada Totem via su válvula NC. Este módulo solo cuida el nivel de la fuente.

## Pendientes

🔴 Niveles exactos de los flotadores (porcentaje de capacidad del tanque padre).

Sensores de calidad de solución (pH, EC) ya definidos para el MVP — ver `sistema-tanque-suministro.md` § "Variables de calidad de agua — MVP". Temperatura de agua queda fuera por ahora.
