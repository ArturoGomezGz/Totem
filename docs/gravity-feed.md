# Sistema de Abastecimiento por Gravedad

**Estado:** concepto — pendiente de formalizar como proyecto. **No forma parte del MVP de Totem.** Compatible por diseño con la Capa 1 sin cambios de código.

---

## Idea central

Un tanque padre elevado físicamente por encima del tanque del Totem abastece agua por gravedad. No se necesita bomba en el tanque padre — la diferencia de altura genera la presión suficiente. El Totem controla su propia entrada de agua mediante la válvula solenoide NC ya instalada en su tubería de entrada (FR-39).

Esto elimina un componente activo completo del sistema y reduce la integración física a conectar una manguera.

---

## Diagrama conceptual

```
[Tanque padre — elevado]
        │
        │  gravedad / presión estática
        │
        ▼
  [Válvula NC] ←── controlada por ESP32 del Totem
        │
        ▼
  [Tanque Totem]
        │
        ├── Flotador 90% (tope de llenado)
        └── Flotador 30% (umbral de alerta)
```

---

## Comportamiento de la válvula NC

| Condición | Estado válvula | Resultado |
|---|---|---|
| ESP32 activo, tanque bajo 30% | Abierta (energizada) | Llenado normal |
| ESP32 detecta flotador 90% | Cerrada | Llenado se detiene |
| ESP32 cuelga o pierde corriente | Cerrada (estado natural) | No puede desbordarse |
| Fallo de software o WiFi | Cerrada (estado natural) | Falla segura por diseño |

El desbordamiento requeriría un fallo activo (válvula forzada abierta), no pasivo. La válvula NC solo consume corriente cuando está abierta — en operación normal el consumo es cero, ideal para un sistema solar.

---

## Estados del sistema de flotadores

| Flotador 90% | Flotador 30% | Estado | Acción |
|---|---|---|---|
| Sumergido | Sumergido | Lleno (> 90%) | Válvula cerrada, LED verde |
| En aire | Sumergido | Normal (30–90%) | Sin acción |
| En aire | En aire | Bajo (< 30%) | Válvula abierta, LED rojo, alerta Telegram |

---

## Comportamiento en el MVP (llenado manual)

En el MVP no existe tanque padre — el usuario recarga el tanque manualmente. La válvula solenoide y los flotadores funcionan igual con llenado manual. La válvula puede instalarse en el MVP como preparación para la integración futura sin ningún cambio posterior en hardware o firmware.

---

## Tanque padre como sistema independiente (fase futura)

El tanque padre es un sistema autónomo, no una extensión del Totem.

**Responsabilidades del tanque padre:**
- Monitorear su propio nivel de agua
- Medir calidad del agua: pH, conductividad eléctrica (EC), temperatura
- Alertar cuando su nivel sea bajo (requiere recarga humana)
- Estar físicamente elevado sobre el nivel del Totem

**Lo que NO hace:**
- No controla cuándo llenar el Totem — esa responsabilidad es del Totem via la válvula NC
- No tiene bomba
- No necesita conocer el estado interno del Totem

**Implementación:** el tanque padre correría en su propio ESP32 y se registraría como una unidad adicional en el mismo sistema — misma API, mismo dashboard. Sin cambios de firmware ni de API en el Totem.

---

## Ventajas frente a bomba en tanque padre

| Dimensión | Bomba en tanque padre | Gravedad + válvula NC |
|---|---|---|
| Componentes | Bomba + válvula o flotador de corte | Solo válvula NC en el Totem |
| Puntos de fallo | Motor, impeller, control de bomba | Solo la válvula |
| Consumo energético | Bomba activa durante el llenado | Solo válvula NC durante el llenado |
| Ruido | Sí (motor) | No |
| Seguridad ante fallo | Requiere mecanismo de corte adicional | NC = falla segura por diseño |
| Costo | Bomba + válvula / flotador | Solo válvula NC |
| Replicabilidad | Moderada | Alta |

**Condición de instalación:** el tanque padre debe estar elevado al menos unos centímetros por encima del nivel máximo del tanque Totem para garantizar presión positiva. A mayor altura, mayor caudal. Variable de instalación — sin implicaciones en firmware ni API.

---

## Decisiones pendientes

- Modelo específico de válvula solenoide NC (voltaje, caudal máximo, presión, materiales en contacto con agua)
- Altura mínima de instalación del tanque padre para caudal suficiente
- Sensores de calidad de agua del tanque padre (pH, EC, temperatura)
- Capacidad del tanque padre en función del consumo del Totem
- Si el tanque padre tiene su propio flotador de mínimo y cómo se integra con el sistema de alertas

---

## Documentos relacionados

- `docs/requirements.md` — FR-39 a FR-42 (válvula NC y flotadores, parte del MVP)
- `docs/planned-features.md` — referenciado como feature futura
- `docs/architecture.md` — comportamiento del sistema de nivel de tanque en Capa 1
