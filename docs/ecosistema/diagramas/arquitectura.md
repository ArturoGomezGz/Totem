# Arquitectura del sistema Totem — descripción para diagrama

Este documento describe la arquitectura completa del sistema de forma estructurada para usarse como base de un diagrama. Cada sección define componentes, agrupaciones y flujos de datos con suficiente detalle para que el diagrama sea generado sin ambigüedad.

---

## Visión general

Totem es un sistema aeropónico vertical modular controlado por software. Tiene dos capas independientes que se comunican via MQTT (dispositivos ↔ server) y HTTP/REST (dashboard ↔ server):

- **Capa 1 — Edge (ESP32):** opera localmente en cada unidad física. Sensa, decide y actúa sin depender de internet.
- **Capa 2 — Server:** almacena datos, expone el dashboard y envía notificaciones. Deployment-agnostic (Raspberry Pi, VPS o cloud).

Adicionalmente existe un **Simulador** que genera lecturas sintéticas y se comporta exactamente igual que un ESP32 desde la perspectiva del server — permite desarrollar el stack sin hardware físico.

---

## Componentes del sistema

### Grupo A — Capa 1: Edge (por unidad física)

Cada unidad Totem tiene exactamente un ESP32. Los componentes de este grupo viven en el borde (dispositivo físico).

| Componente | Descripción |
|---|---|
| **Sensores ambientales** | Temperatura (T), Humedad relativa (RH), Intensidad lumínica (Li / PAR). Alimentan el Módulo de Decisión de Riego. CO₂ fue evaluado y descartado del diseño (10 jul 2026) — ver `sistema-decision/modulo-decision.md`. |
| **Flotadores de nivel** | Dos flotadores digitales: flotador bajo (~30%) y flotador alto (~90%). El ESP32 los lee directamente. No se persisten en DB — controlan la válvula y generan alertas. |
| **ESP32** | Microcontrolador central de la unidad. Orquesta el ciclo de operación completo |
| **Módulo de Decisión de Riego** | Subcomponente del ESP32. Calcula VPD (Déficit de Presión de Vapor) a partir de T y RH con fórmula cerrada — sin modelo ML — y usa Li como modulador simple de la duración del ciclo, y decide si activar la bomba y por cuánto tiempo |
| **Perfil de Cultivo (caché flash)** | Copia local del perfil de cultivo activo, almacenada en flash del ESP32. Contiene umbral de VPD, rangos ambientales ideales y parámetros de duración de riego |
| **Buffer offline (flash)** | Cola local en flash. Almacena lecturas y eventos cuando no hay conexión WiFi, para reenvío ordenado al reconectar |
| **Bomba de riego** | Actuador. El ESP32 la enciende/apaga según la decisión del Módulo de Decisión de Riego o un comando de override |
| **Válvula solenoide NC** | Actuador en la entrada de agua del tanque. Normalmente cerrada — requiere corriente para abrirse. Se abre cuando el flotador del 30% está en aire; se cierra cuando el del 90% se activa. Agnóstica a la fuente de agua. |
| **LEDs** | LED rojo (flotador 30% en aire = nivel bajo) y LED verde (flotador 90% sumergido = tanque lleno). Indicadores locales físicos, sin lógica adicional. |
| **WiFi** | Módulo de conectividad del ESP32. Cuando hay señal, permite comunicación con la Capa 2 |

### Grupo B — Capa 2: Server (deployment-agnostic)

Todos los componentes de este grupo corren en el mismo host (Raspberry Pi, VPS o cloud) orquestados con Docker Compose.

| Componente | Descripción |
|---|---|
| **Broker MQTT (Mosquitto)** | Intermediario de mensajes entre ESP32 y FastAPI. Recibe publicaciones de los dispositivos y las reenvía a los suscriptores. Publica comandos y perfiles a topics por unidad. |
| **FastAPI (API REST)** | Backend principal. Suscrito al broker para persistir lecturas, eventos y alertas. Publica comandos y perfiles al broker. Expone el histórico al dashboard y gestiona OTA. |
| **TimescaleDB** | Base de datos única. Hypertable `readings` para series de tiempo (lecturas de sensores) + tablas relacionales: `units`, `users`, `crop_profiles`, `pump_events`, `commands`, `alerts` |
| **React + Vite (Dashboard web)** | Frontend SPA. Se sirve como archivos estáticos. El navegador del usuario hace polling a la API cada 30–60 segundos para actualizar la vista |
| **Bot de Telegram** | Módulo del server que envía notificaciones y alertas al usuario via HTTP a la API de Telegram. En el MVP es solo pasivo (envío); comandos bidireccionales son feature futura |

### Grupo C — Externo

| Componente | Descripción |
|---|---|
| **API de Telegram** | Servicio externo. El server le envía mensajes HTTP para disparar notificaciones. Solo requiere que el server tenga salida a internet — no necesita IP pública ni port forwarding |
| **Navegador del usuario** | Cliente del dashboard web. Accede desde cualquier dispositivo con navegador. En deployments locales (RPi), el acceso puede estar limitado a la red local |

### Grupo D — Simulador (desarrollo)

| Componente | Descripción |
|---|---|
| **Simulator (Python)** | Genera lecturas sintéticas y las envía al server exactamente igual que un ESP32 real. Usa la misma autenticación (API key) y los mismos topics MQTT. Permite desarrollar DB, frontend y ML sin hardware físico |

---

## Flujos de datos

### F1 — Ciclo de operación autónomo (Capa 1, local, siempre activo)

```
Sensores ambientales ──[T, RH, Li]──► ESP32
ESP32 ──[T, RH, Li]──► Módulo de Decisión de Riego
Módulo de Decisión de Riego ──[lee]──► Perfil de Cultivo (caché flash)
Módulo de Decisión de Riego ──[VPD ≥ umbral → ON + duración]──► Bomba de riego
ESP32 ──[evento ON/OFF + timestamp + duración]──► Buffer offline (flash)
```

- Frecuencia: configurable — 🔴 intervalo exacto pendiente de cerrar (ver `ecosistema/overview.md`)
- Latencia decisión → actuación: < 5 segundos (NFR-01)
- Este flujo **no depende de WiFi ni del server**. Si no hay conexión, continúa sin interrupción.

### F1b — Control de nivel de tanque (Capa 1, local, reactivo a flotadores)

```
Flotador bajo (30%) ──[en aire]──► ESP32 ──[abre]──► Válvula NC + LED rojo ON
Flotador alto (90%) ──[sumergido]──► ESP32 ──[cierra]──► Válvula NC + LED rojo OFF + LED verde ON
```

- Reactivo: el ESP32 monitorea los flotadores en cada ciclo y actúa de forma inmediata
- Completamente local — no depende de WiFi ni del server
- La válvula NC en ausencia de corriente (fallo ESP32) permanece cerrada: falla segura
- Si el flotador del 30% se activa: además del control local, dispara envío inmediato de alerta (ver F3)

### F2 — Envío periódico de datos al server (cuando hay WiFi)

```
ESP32 ──[MQTT PUBLISH totem/{unit_id}/readings, QoS 1]──► Mosquitto
ESP32 ──[MQTT PUBLISH totem/{unit_id}/events, QoS 1]──► Mosquitto
Mosquitto ──[forward a suscriptores]──► FastAPI
FastAPI ──[INSERT]──► TimescaleDB
```

- Frecuencia: 🔴 pendiente de cerrar (ver `ecosistema/overview.md`)
- Si no hay WiFi: lecturas y eventos se acumulan en el Buffer offline (flash) y se publican al reconectar (FR-06)
- El nivel de tanque no se incluye en `readings` — solo genera alertas

### F3 — Alerta crítica (publicación inmediata, sin esperar timer)

```
ESP32 ──[detecta condición crítica]──► ESP32
ESP32 ──[MQTT PUBLISH totem/{unit_id}/alerts, QoS 1, inmediato]──► Mosquitto
Mosquitto ──[forward]──► FastAPI
FastAPI ──[INSERT alerts]──► TimescaleDB
FastAPI ──[HTTP a Telegram API]──► Bot de Telegram ──► Usuario
```

- Condiciones: tanque bajo (flotador 30° en aire), sensor desconectado, fallo de bomba
- El server guarda la alerta en DB y dispara Telegram en el mismo flujo
- Si no hay salida a internet, la alerta queda en DB con `status = pending` y se envía al reconectar (FR-37)

### F4 — Entrega de comandos y perfil (server → ESP32, push)

```
FastAPI ──[MQTT PUBLISH totem/{unit_id}/commands, QoS 1]──► Mosquitto
Mosquitto ──[forward al suscriptor]──► ESP32
ESP32 ──[ejecuta: pump_on / pump_off / pause_autonomous / update_profile / valve_open / valve_close]──► Bomba, Válvula NC o Perfil de Cultivo (flash)

FastAPI ──[MQTT PUBLISH totem/{unit_id}/profile, QoS 1]──► Mosquitto
Mosquitto ──[forward]──► ESP32
ESP32 ──[guarda]──► Perfil de Cultivo (caché flash)
```

- Latencia de entrega: milisegundos desde que FastAPI publica al broker
- El ESP32 está suscrito a sus topics desde el momento de conexión
- QoS 1 garantiza entrega at-least-once sin retry manual en el firmware

### F5 — OTA (Over The Air firmware update)

```
FastAPI ──[MQTT PUBLISH totem/{unit_id}/ota, QoS 1, { version, download_url, hash }]──► Mosquitto
Mosquitto ──[forward]──► ESP32
ESP32 ──[si versión > instalada: GET /api/v1/firmware/{version}/binary, HTTPS]──► FastAPI
ESP32 ──[verifica hash de integridad]──► ESP32
ESP32 ──[reinicia con nuevo firmware / rollback si falla]──► ESP32
```

- La notificación llega por MQTT; la descarga del binario es HTTP (MQTT no es adecuado para payloads grandes)

### F6 — Dashboard (usuario → server)

```
Navegador ──[POST /api/v1/auth/login]──► FastAPI ──[JWT + refresh token]──► Navegador
Navegador ──[GET /api/v1/units, polling 30–60s, Bearer JWT]──► FastAPI
Navegador ──[GET /api/v1/units/{id}, Bearer JWT]──► FastAPI
Navegador ──[GET /api/v1/units/{id}/readings?from=&to=, Bearer JWT]──► FastAPI
Navegador ──[GET /api/v1/units/{id}/events, Bearer JWT]──► FastAPI
Navegador ──[GET /api/v1/alerts, Bearer JWT]──► FastAPI
FastAPI ──[SELECT]──► TimescaleDB ──[datos]──► FastAPI ──[JSON]──► Navegador
```

- El dashboard NO usa WebSockets. Polling simple desde el navegador.
- Actualización automática cada 30–60 segundos (NFR-02)

### F7 — Control manual desde dashboard

```
Navegador ──[POST /api/v1/units/{id}/commands, Bearer JWT]──► FastAPI
FastAPI ──[INSERT en tabla commands]──► TimescaleDB
FastAPI ──[MQTT PUBLISH totem/{unit_id}/commands, QoS 1]──► Mosquitto ──► ESP32
ESP32 ──[ejecuta override]──► Bomba
```

- El comando llega al ESP32 en milisegundos desde que el usuario lo envía desde el dashboard

### F8 — Gestión de perfiles de cultivo

```
Navegador ──[POST /api/v1/profiles, Bearer JWT]──► FastAPI ──[INSERT]──► TimescaleDB
Navegador ──[PUT /api/v1/units/{id}/profile, Bearer JWT]──► FastAPI
FastAPI ──[MQTT PUBLISH totem/{unit_id}/profile, QoS 1]──► Mosquitto ──► ESP32
ESP32 ──[guarda en flash]──► Perfil de Cultivo (caché flash)
```

### F9 — Simulador (reemplaza al ESP32 en desarrollo)

```
Simulator ──[MQTT PUBLISH totem/{unit_id}/readings, QoS 1]──► Mosquitto  (idéntico a F2)
Simulator ──[MQTT PUBLISH totem/{unit_id}/events, QoS 1]──► Mosquitto    (idéntico a F2)
Simulator ──[suscrito a totem/{unit_id}/commands]──► Mosquitto            (idéntico a F4)
```

---

## Autenticación — resumen

| Actor | Mecanismo | Credencial |
|---|---|---|
| ESP32 → Broker MQTT | Username/password ante Mosquitto | `username: unit_id` / `password: api_key` |
| Simulator → Broker MQTT | Mismas credenciales que un ESP32 | `username: unit_id` / `password: api_key` |
| Dashboard → API HTTP | JWT (expira en ~1h) + refresh token | `Authorization: Bearer <jwt>` |

---

## Ciclo de vida del Perfil de Cultivo Activo

El perfil es el nexo entre la Capa 2 y la lógica de decisión de la Capa 1:

```
1. Usuario crea/edita perfil → dashboard → POST/PUT /api/v1/profiles → TimescaleDB
2. Usuario asigna perfil a unidad → dashboard → PUT /api/v1/units/{id}/profile → FastAPI
3. FastAPI publica perfil → MQTT PUBLISH totem/{unit_id}/profile → Mosquitto
4. ESP32 (suscrito) recibe el perfil en milisegundos
5. ESP32 guarda en flash (sobreescribe anterior)
6. Módulo de Decisión de Riego usa el nuevo perfil desde ese momento
7. Sin conexión: ESP32 sigue usando el último perfil conocido en flash
```

---

## Comportamiento offline — degradación por capas

| Condición | Impacto en Capa 1 | Impacto en Capa 2 |
|---|---|---|
| WiFi caído | Riego continúa usando perfil cacheado en flash. Lecturas se acumulan en buffer. | Dashboard no recibe datos nuevos. Alertas no se envían (quedan pendientes en DB al reconectar). |
| Server caído | Igual que WiFi caído desde la perspectiva del ESP32 | Dashboard inaccesible. Bot de Telegram sin notificaciones. |
| Sin salida a internet (deployment local) | Sin impacto | Bot de Telegram inoperativo. Dashboard accesible solo en red local. Riego sin afectación. |

---

## Decisiones pendientes con impacto en el diagrama

Las siguientes decisiones están abiertas y pueden modificar componentes o flujos:

| Ítem | Impacto en arquitectura |
|---|---|
| Parámetros exactos de `f(VPD)` y `g(Li)` | Resuelto en principio (10 jul 2026): VPD por fórmula cerrada, sin modelo ML; `ml/` deja de ser necesario para el modelo base. Interna al Módulo de Decisión de Riego; no cambia la topología del diagrama. |
| Buffer/reintento del ESP32 (tamaño, política de descarte) | Interna a la Capa 1; no cambia la topología |
