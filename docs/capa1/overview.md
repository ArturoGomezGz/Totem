# Capa 1 — Microcontrolador y Hardware

Todo lo que corre en un ESP32 y opera hardware directamente. Cada unidad de Capa 1 es autónoma — opera sin depender de la Capa 2.

La Capa 1 puede tener dos tipos de unidades. Ambas se registran en la misma Capa 2 (misma API, mismo dashboard):

---

## Unidades

### [Totem Principal](totem-principal/)

La unidad aeropónica. Sensa el ambiente, decide cuándo regar y ejecuta el riego. Siempre presente — es el núcleo del sistema.

| Sistema | Responsabilidad |
|---|---|
| [Sistema de Decisión de Riego](totem-principal/sistema-decision/sistema-decision.md) | Decide cuándo y cuánto regar en función del estado fisiológico de la planta |
| [Sistema de Riego](totem-principal/sistema-riego/sistema-riego.md) | Verifica nivel de solución y actúa la bomba |
| [Sistema de Conectividad](totem-principal/sistema-conectividad/sistema-conectividad.md) | Comunica con Capa 2; buffer offline cuando no hay WiFi |

### [Tanque de Suministro](tanque-de-suministro/) — opcional

Unidad independiente que provee solución nutritiva. Puede alimentar uno o varios Totems. Sustituible por una llave de agua — el Totem no sabe ni le importa qué hay del otro lado de su válvula.

| Sistema / Módulo | Responsabilidad |
|---|---|
| [sistema-tanque-suministro.md](tanque-de-suministro/sistema-tanque-suministro.md) | Visión general, integración con Totems, operación por gravedad |
| [Módulo de Flotadores](tanque-de-suministro/modulo-flotadores.md) | Monitorea nivel de solución disponible |
| [Sistema de Conectividad](tanque-de-suministro/sistema-conectividad/sistema-conectividad.md) | Reporta nivel y alertas a Capa 2 |

---

## Principio de diseño

Cada sistema dentro de cada unidad es independiente. Pueden desarrollarse, probarse y validarse por separado. El Totem Principal y el Tanque de Suministro son independientes entre sí — se conectan solo a través de una válvula NC y la Capa 2.
