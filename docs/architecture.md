# Arquitectura del sistema

Documentación de referencia completa: [Notion — Arquitectura](https://app.notion.com/p/3839cfa57faf80f1a83ec8a8d56ae007)

---

## Dos capas independientes

```
┌─────────────────────────────────────────┐
│  Capa 1 — Edge (ESP32, por unidad)      │
│                                         │
│  Sensado → estimación Pn → decisión     │
│  de riego → actuación de bomba          │
│                                         │
│  Opera sin internet. Siempre activo.    │
└─────────────────┬───────────────────────┘
                  │ HTTP/REST (cuando hay conexión)
                  │ cada 5 min · inmediato en alertas críticas
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

**Ciclo principal (cada 5 min):**
1. Leer sensores: T, RH, Li, CO₂, nivel de tanque
2. Ejecutar Módulo de Decisión de Riego → determinar si activar bomba y por cuánto tiempo
3. Registrar evento en buffer local (flash)
4. Si hay conexión: enviar lecturas y eventos al server, consultar comandos pendientes y perfil actualizado

**Comportamiento offline:** la decisión de riego continúa sin interrupción usando el Perfil de Cultivo Activo cacheado en flash. Lo que se degrada sin conexión: acceso remoto al dashboard y notificaciones.

## Módulo de Decisión de Riego

Estima la tasa de fotosíntesis (Pn) a partir de T, RH, Li y CO₂, y usa ese valor para decidir cuándo y cuánto regar.

- **Pn < umbral del perfil activo** → activar bomba (duración dinámica: menor Pn = ciclo más largo)
- **Pn ≥ umbral** → no regar

El modelo ML específico (SVR, BPNN, ANN) y la función Pn → duración del ciclo están pendientes de decidir. Ver [Notion — Módulo de Decisión de Riego](https://app.notion.com/p/3849cfa57faf80b0b57de6bf147fb988).

## Perfil de Cultivo Activo

Entidad de configuración que parametriza el comportamiento del sistema por especie de cultivo:
- Umbral de Pn para activar riego
- Rangos ambientales ideales (T, RH, Li, CO₂) — usados para alertas
- Duración dinámica del ciclo de riego (función de Pn, pendiente de definir)

Vive en la DB de Capa 2, se cachea en flash del ESP32. Se asigna y cambia desde el dashboard. Ver [Notion — Perfil de Cultivo Activo](https://app.notion.com/p/3839cfa57faf8006810bcf11129c0593).

## Capa 2 — Server

Stack deployment-agnostic. La misma codebase corre en Raspberry Pi, VPS o cloud sin modificaciones.

**Componentes:**
- **API** — recibe lecturas de sensores, sirve perfiles de cultivo, mantiene cola de comandos por dispositivo, expone endpoints de OTA
- **Base de datos** — series de tiempo para lecturas de sensores + tablas relacionales para metadatos (stack exacto pendiente de decidir: TimescaleDB vs. InfluxDB)
- **Frontend** — dashboard web responsive en español (con i18n), polling cada 30–60s, gráficas de T/RH/Pn/eventos de riego, control manual de bomba, gestión de perfiles
- **Alertas** — recibe condiciones críticas del ESP32, notifica por push/SMS/email según disponibilidad del entorno

## Decisiones de arquitectura tomadas

| Decisión | Resolución | Fecha |
|---|---|---|
| Cómputo por unidad | 1 ESP32 por unidad Totem, nunca compartido | 18 jun 2026 |
| Capa 2 | Server deployment-agnostic (RPi, VPS, cloud sin cambios de código) | 19 jun 2026 |
| Modo sin internet | Riego continúa sin degradación; dashboard y alertas se interrumpen (aceptable) | 18 jun 2026 |
| Deploy | Docker Compose o equivalente — requisito central de portabilidad | — |
| Protocolo ESP32 ↔ server | HTTP/REST sobre HTTPS | 22 jun 2026 |
| Intervalo de comunicación | 5 min fijo en modo normal; envío inmediato ante alerta crítica (tanque bajo, sensor desconectado) | 22 jun 2026 |
| Autenticación de dispositivos | API key por unidad — header `X-API-Key` en cada request | 22 jun 2026 |
| Autenticación de usuarios | JWT con refresh token — header `Authorization: Bearer` | 22 jun 2026 |
| Esquema de lecturas de sensores | Tabla ancha — una columna por tipo de sensor (T, RH, Li, CO₂). Nivel de tanque no se persiste en `readings` — solo genera alertas. | 22 jun 2026 |
| Ubicación de inferencia ML (Pn) | En dispositivo — modelo `.tflite` embebido en el ESP32. La inferencia corre localmente sin depender del server. | 22 jun 2026 |
| Sensor de nivel de tanque | Dos flotadores digitales: uno a ~30% (alerta) y otro a ~90% (tope de llenado). No se almacenan en `readings` — solo generan alertas y controlan la válvula. | 22 jun 2026 |
| Válvula solenoide NC (MVP) | Válvula normalmente cerrada en la entrada de agua del tanque. Se abre cuando el flotador del 30% está en aire; se cierra cuando el del 90% se activa. Agnóstica a la fuente de agua (tanque elevado, llave, manguera). Falla segura: sin corriente = cerrada. | 22 jun 2026 |
| LEDs de indicación (MVP) | Dos LEDs en la unidad física: rojo (nivel bajo, flotador 30% en aire) y verde (tanque lleno, flotador 90% sumergido). Sin lógica adicional. | 22 jun 2026 |

## Decisiones pendientes

### Firmware ↔ server — interfaz

Estas preguntas bloquean la implementación del firmware:

- **Aprovisionamiento de unidades** — ¿Cómo obtiene el ESP32 su API key inicial? No hay endpoint de registro documentado. ¿Provisioning manual via el dashboard? ¿Cómo llega la key al dispositivo (serial, BLE, config file)?
- **Política del buffer offline** — Tamaño en flash, política de descarte (FIFO vs. drop-newest), intervalo de retry al reconectar, orden de reenvío (secuencial vs. lote).
- **Confirmación de ejecución de comandos** — El campo `consumed_at` en `commands` marca recepción, pero ¿el firmware reporta el resultado? Si `pump_on` falla (bomba no responde), ¿genera una alerta o actualiza el estado del comando?
- **Comportamiento en primer arranque (factory state)** — Sin perfil en flash, ¿qué hace el ESP32? ¿Espera conectarse al server antes del primer ciclo de riego? ¿Tiene parámetros de emergencia por defecto?
- **Frescura del perfil cacheado** — ¿Tiene TTL el caché en flash? Si el ESP32 lleva semanas offline, ¿el perfil cacheado sigue siendo válido indefinidamente?
- **Intervalo de chequeo de OTA** — ¿Se chequea en cada ciclo (5 min) o con un intervalo propio más largo? Trade-off: latencia de actualización vs. overhead de requests.
- **Manejo de error 401** — Si el server devuelve 401 (API key revocada o inválida), ¿qué hace el ESP32? ¿Entra en modo offline indefinido?

### ML

- Algoritmo ML para estimación de Pn (SVR, BPNN, ANN u otro) — la ubicación de inferencia ya está cerrada (en dispositivo)
- Función Pn → duración de ciclo de riego

Ver lista completa en [Notion — Requerimientos](https://app.notion.com/p/3839cfa57faf80db8999dd0349729ea0).
