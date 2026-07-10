# Arquitectura del sistema

Documentación de referencia completa: [Notion — Arquitectura](https://app.notion.com/p/3839cfa57faf80f1a83ec8a8d56ae007)

---

## Dos capas independientes

```
┌─────────────────────────────────────────┐
│  Capa 1 — Edge (ESP32, por unidad)      │
│                                         │
│  Sensado → VPD + luz → decisión         │
│  de riego → actuación de bomba          │
│                                         │
│  Opera sin internet. Siempre activo.    │
└─────────────────┬───────────────────────┘
                  │ MQTT (cuando hay WiFi)
                  │ publicación continua · comandos por suscripción
┌─────────────────▼───────────────────────┐
│  Capa 2 — Server (deployment-agnostic)  │
│                                         │
│  Base de datos · Dashboard · Alertas    │
│  OTA · Gestión de perfiles de cultivo   │
│                                         │
│  Raspberry Pi / VPS / cloud — sin       │
│  cambios de código. Deploy via Docker.  │
└─────────────────────────────────────────┘
```

## Capa 1 — Firmware ESP32

Cada unidad Totem tiene exactamente un ESP32. Nunca se comparte entre varias unidades.

**Ciclo principal:**
1. Leer sensores: T, RH, Li, nivel de tanque (flotador local), y opcionalmente pH/EC de la solución del propio tanque (FR-43, no alimenta la decisión de riego — ver `capa1/totem-principal/sistema-decision/modulo-lectura-sensores.md`). CO₂ fue evaluado y **descartado** del conjunto de sensores — ver justificación en `capa1/totem-principal/sistema-decision/modulo-decision.md`
2. Ejecutar Módulo de Decisión de Riego → determinar si activar bomba y por cuánto tiempo
3. Registrar evento en buffer local (flash)
4. Si hay WiFi: publicar lecturas y eventos al broker MQTT; recibir comandos y perfil actualizado por suscripción

El intervalo del ciclo y la frecuencia de publicación MQTT son decisiones pendientes de cerrar (ver sección correspondiente abajo).

**Comportamiento offline:** la decisión de riego continúa sin interrupción usando el Perfil de Cultivo Activo cacheado en flash. Lo que se degrada sin conexión: acceso remoto al dashboard y notificaciones.

## Módulo de Decisión de Riego

**Decidido (10 jul 2026):** el riego se decide a partir del **Déficit de Presión de Vapor (VPD)**, calculado con fórmula cerrada a partir de T y RH — no un modelo de ML entrenado. La luz (Li) modula la duración del ciclo con un coeficiente simple, sin modelo ML en el MVP. Reemplaza el enfoque anterior de estimar Pn con ML (T, RH, Li, CO₂). Justificación completa, citas de literatura y comparación de alternativas en `capa1/totem-principal/sistema-decision/modulo-decision.md`.

- **VPD ≥ umbral del perfil activo** (aire "demanda" más agua de la que la planta puede reponer) → activar bomba (duración dinámica, modulada por Li)
- **VPD < umbral** → no regar

## Perfil de Cultivo Activo

Entidad de configuración que parametriza el comportamiento del sistema por especie de cultivo:
- Umbral de VPD para activar riego (kPa)
- Rangos ambientales ideales (T, RH, Li) — usados para alertas
- Duración dinámica del ciclo de riego (función de VPD y Li)

Vive en la DB de Capa 2, se cachea en flash del ESP32. Se asigna y cambia desde el dashboard. Ver [Notion — Perfil de Cultivo Activo](https://app.notion.com/p/3839cfa57faf8006810bcf11129c0593).

## Capa 2 — Server

Stack deployment-agnostic. La misma codebase corre en Raspberry Pi, VPS o cloud sin modificaciones.

**Componentes:**
- **API** — suscrita al broker MQTT para persistir lecturas, eventos y alertas; publica comandos y perfiles a topics por unidad; expone endpoints HTTP para el dashboard y descarga de binarios OTA
- **Base de datos** — series de tiempo para lecturas de sensores + tablas relacionales para metadatos (stack exacto pendiente de decidir: TimescaleDB vs. InfluxDB)
- **Frontend** — dashboard web responsive en español (con i18n), polling cada 30–60s, gráficas de T/RH/VPD/eventos de riego, control manual de bomba, gestión de perfiles
- **Alertas** — recibe condiciones críticas del ESP32, notifica por push/SMS/email según disponibilidad del entorno

## Decisiones de arquitectura tomadas

| Decisión | Resolución | Fecha |
|---|---|---|
| Cómputo por unidad | 1 ESP32 por unidad Totem, nunca compartido | 18 jun 2026 |
| Capa 2 | Server deployment-agnostic (RPi, VPS, cloud sin cambios de código) | 19 jun 2026 |
| Modo sin internet | Riego continúa sin degradación; dashboard y alertas se interrumpen (aceptable) | 18 jun 2026 |
| Deploy | Docker Compose o equivalente — requisito central de portabilidad | — |
| Protocolo ESP32 ↔ server | MQTT con broker Mosquitto. Conexión persistente con TLS. El ESP32 publica lecturas y eventos; se suscribe a comandos, perfil y OTA. ~~HTTP/REST (decisión anterior — 22 jun 2026, reemplazada)~~ | 23 jun 2026 |
| Intervalo de comunicación | Pendiente de cerrar — ver "Decisiones pendientes" | — |
| Autenticación de dispositivos | API key por unidad — `unit_id` como client ID MQTT, API key como contraseña | 22 jun 2026 |
| Autenticación de usuarios | JWT con refresh token — header `Authorization: Bearer` | 22 jun 2026 |
| Esquema de lecturas de sensores | Tabla ancha — una columna por tipo de sensor (T, RH, Li, CO₂, y desde 9 jul 2026 también `ph`/`ec` reportados por Totem y tanque padre, y `tank_level` exclusivo del tanque padre). Nivel del Totem no se persiste en `readings` — solo genera alertas; nivel del tanque padre sí se persiste como serie de tiempo. Ver `capa2/schema.md`. | 22 jun 2026, revisado 9 jul 2026 |
| Ubicación de inferencia ML (Pn) | ~~En dispositivo — modelo `.tflite` embebido en el ESP32~~ — superada por la decisión del 10 jul 2026: el cálculo de riego ya no requiere un modelo ML entrenado (ver fila siguiente), pero el principio de cómputo local en el ESP32 se mantiene y se refuerza. | 22 jun 2026, superada 10 jul 2026 |
| Modelo de decisión de riego: VPD en vez de Pn con ML | El riego se dispara por Déficit de Presión de Vapor (VPD), calculado con fórmula cerrada (T, RH) directamente en el ESP32 — sin modelo entrenado. La luz (Li) modula la duración del ciclo con un coeficiente simple, sin ML en el MVP. Se descarta el sensor de CO₂ del conjunto de entradas. Justificación completa en `capa1/totem-principal/sistema-decision/modulo-decision.md`. | 10 jul 2026 |
| Sensor de nivel de tanque (Totem) | ~~Dos flotadores digitales: uno a ~30% (alerta) y otro a ~90% (tope de llenado)~~ — revisado. **Un solo flotador**: sumergido = nivel suficiente (válvula cerrada), en aire = nivel bajo (válvula abierta, alerta). No se almacena en `readings` — solo control local de válvula y alerta. Razón de la simplificación: el nivel del Totem no se reporta como serie de tiempo, así que no aporta valor tener dos umbrales; ver `capa1/totem-principal/sistema-riego/modulo-suministro.md` | 22 jun 2026, revisado 9 jul 2026 |
| Sensor de nivel de tanque padre (abastecimiento) | Tres flotadores digitales — más granularidad que el Totem porque aquí el nivel sí se reporta a Capa 2 como serie de tiempo. Ver `capa1/tanque-de-suministro/modulo-flotadores.md` | 9 jul 2026 |
| Válvula solenoide NC (MVP) | Válvula normalmente cerrada en la entrada de agua del tanque. ~~Se abre cuando el flotador del 30% está en aire; se cierra cuando el del 90% se activa~~ — revisado: se abre cuando el único flotador está en aire, se cierra cuando vuelve a sumergirse. Agnóstica a la fuente de agua (tanque elevado, llave, manguera). Falla segura: sin corriente = cerrada. | 22 jun 2026, revisado 9 jul 2026 |
| LEDs de indicación (MVP) | Dos LEDs en la unidad física: rojo (nivel bajo, flotador en aire) y verde (nivel suficiente, flotador sumergido). Sin lógica adicional. | 22 jun 2026, revisado 9 jul 2026 |
| Gestión de firmware | `firmware_releases` privada por organización (cada org sube y versiona sus propios compilados). Aplicar un release a una unidad o a toda la organización reutiliza `commands` (`type = update_firmware`), sin tabla de deployments nueva. `units.target_firmware_release_id` distingue versión deseada vs. `firmware_version` reportada. Ver `capa2/schema.md`. | 2 jul 2026 |

## Decisiones pendientes

### Firmware ↔ server — interfaz

Estas preguntas bloquean la implementación del firmware:

- **Intervalo del ciclo de decisión** — ¿Cada cuánto corre el ciclo completo (lectura de sensores + inferencia ML + decisión de riego)? Candidato: 3 min.
- **Intervalo de publicación MQTT** — ¿El ciclo de telemetría coincide con el de decisión o son independientes? Candidato: mismo intervalo (3 min); eventos críticos siempre inmediatos.
- **Aprovisionamiento de unidades** — ¿Cómo obtienen el ESP32 su `unit_id` y API key iniciales? ¿Provisioning manual via dashboard? ¿Cómo llegan las credenciales al dispositivo (serial, BLE, config file)?
- **Política del buffer offline** — Tamaño en flash, política de descarte (FIFO vs. drop-newest), orden de reenvío al reconectar.
- **Confirmación de ejecución de comandos** — El ESP32 recibe el comando via MQTT (QoS 1 garantiza entrega), pero ¿reporta el resultado de ejecución? Si `pump_on` falla, ¿publica una alerta o un ACK de fallo?
- **Comportamiento en primer arranque (factory state)** — Sin perfil en flash, ¿qué hace el ESP32? ¿Espera recibir el perfil via MQTT antes del primer ciclo de riego? ¿Tiene parámetros de emergencia por defecto?
- **Frescura del perfil cacheado** — ¿Tiene TTL el caché en flash? Si el ESP32 lleva semanas offline, ¿el perfil cacheado sigue siendo válido indefinidamente?
- **OTA** — La notificación llega por MQTT; la descarga del binario es HTTP. ¿Verificación de firma criptográfica además del hash? (La gestión de releases por organización y el mecanismo de aplicación a unidad/organización ya están cerrados — ver tabla de decisiones arriba y `capa2/schema.md`.)
- **Manejo de fallo de autenticación MQTT** — Si el broker rechaza las credenciales del ESP32, ¿qué hace? ¿Reintenta, entra en modo solo-local indefinido?

### ML

- ~~Algoritmo ML para estimación de Pn (SVR, BPNN, ANN u otro)~~ — **resuelto (10 jul 2026):** no se usa modelo ML entrenado; el riego se decide por VPD (fórmula cerrada). Ver `capa1/totem-principal/sistema-decision/modulo-decision.md`.
- ~~Función Pn → duración de ciclo de riego~~ — **resuelto en principio (10 jul 2026):** duración = f(VPD) × g(Li). Pendiente solo la calibración fina de los coeficientes por especie/etapa (ver OI-IRR-02 en `modulo-decision.md`).

Ver lista completa en [Notion — Requerimientos](https://app.notion.com/p/3839cfa57faf80db8999dd0349729ea0).
