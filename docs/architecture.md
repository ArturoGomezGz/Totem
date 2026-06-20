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
                  │ HTTPS (cuando hay conexión)
                  │ polling cada 1–5 min
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

**Ciclo principal (cada 1–5 min):**
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

## Decisiones pendientes

- Stack técnico exacto (FastAPI + qué DB)
- Protocolo de comunicación ESP32 ↔ server (HTTP/REST vs. MQTT)
- Algoritmo ML para estimación de Pn e inferencia en dispositivo vs. server
- Buffer/reintento de datos en el ESP32 (tamaño, política de descarte)
- Mecanismo de notificaciones (proveedores, jerarquía por tipo de evento)

Ver lista completa en [Notion — Requerimientos](https://app.notion.com/p/3839cfa57faf80db8999dd0349729ea0).
