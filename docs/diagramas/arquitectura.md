# Arquitectura del sistema Totem — descripción para diagrama

Este documento describe la arquitectura completa del sistema de forma estructurada para usarse como base de un diagrama. Cada sección define componentes, agrupaciones y flujos de datos con suficiente detalle para que el diagrama sea generado sin ambigüedad.

---

## Visión general

Totem es un sistema aeropónico vertical modular controlado por software. Tiene dos capas independientes que se comunican por HTTP/REST sobre HTTPS:

- **Capa 1 — Edge (ESP32):** opera localmente en cada unidad física. Sensa, decide y actúa sin depender de internet.
- **Capa 2 — Server:** almacena datos, expone el dashboard y envía notificaciones. Deployment-agnostic (Raspberry Pi, VPS o cloud).

Adicionalmente existe un **Simulador** que genera lecturas sintéticas y se comporta exactamente igual que un ESP32 desde la perspectiva del server — permite desarrollar el stack sin hardware físico.

---

## Componentes del sistema

### Grupo A — Capa 1: Edge (por unidad física)

Cada unidad Totem tiene exactamente un ESP32. Los componentes de este grupo viven en el borde (dispositivo físico).

| Componente | Descripción |
|---|---|
| **Sensores ambientales** | Temperatura (T), Humedad relativa (RH), Intensidad lumínica (Li / PAR), CO₂ (ppm). Alimentan el Módulo de Decisión de Riego. |
| **Flotadores de nivel** | Dos flotadores digitales: flotador bajo (~30%) y flotador alto (~90%). El ESP32 los lee directamente. No se persisten en DB — controlan la válvula y generan alertas. |
| **ESP32** | Microcontrolador central de la unidad. Orquesta el ciclo de operación completo |
| **Módulo de Decisión de Riego** | Subcomponente del ESP32. Estima Pn (tasa de fotosíntesis) a partir de T, RH, Li y CO₂ usando un modelo ML embebido (`.tflite`, inferencia en dispositivo), y decide si activar la bomba y por cuánto tiempo |
| **Perfil de Cultivo (caché flash)** | Copia local del perfil de cultivo activo, almacenada en flash del ESP32. Contiene umbral de Pn, rangos ambientales ideales y parámetros de duración de riego |
| **Buffer offline (flash)** | Cola local en flash. Almacena lecturas y eventos cuando no hay conexión WiFi, para reenvío ordenado al reconectar |
| **Bomba de riego** | Actuador. El ESP32 la enciende/apaga según la decisión del Módulo de Decisión de Riego o un comando de override |
| **Válvula solenoide NC** | Actuador en la entrada de agua del tanque. Normalmente cerrada — requiere corriente para abrirse. Se abre cuando el flotador del 30% está en aire; se cierra cuando el del 90% se activa. Agnóstica a la fuente de agua. |
| **LEDs** | LED rojo (flotador 30% en aire = nivel bajo) y LED verde (flotador 90% sumergido = tanque lleno). Indicadores locales físicos, sin lógica adicional. |
| **WiFi** | Módulo de conectividad del ESP32. Cuando hay señal, permite comunicación con la Capa 2 |

### Grupo B — Capa 2: Server (deployment-agnostic)

Todos los componentes de este grupo corren en el mismo host (Raspberry Pi, VPS o cloud) orquestados con Docker Compose.

| Componente | Descripción |
|---|---|
| **FastAPI (API REST)** | Backend principal. Recibe lecturas y eventos de los ESP32, sirve perfiles de cultivo, mantiene la cola de comandos, expone el histórico al dashboard y gestiona OTA |
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
| **Simulator (Python)** | Genera lecturas sintéticas y las envía al server exactamente igual que un ESP32 real. Usa la misma autenticación (API key) y los mismos endpoints. Permite desarrollar DB, frontend y ML sin hardware físico |

---

## Flujos de datos

### F1 — Ciclo de operación autónomo (Capa 1, local, siempre activo)

```
Sensores ambientales ──[T, RH, Li, CO₂]──► ESP32
ESP32 ──[T, RH, Li, CO₂]──► Módulo de Decisión de Riego
Módulo de Decisión de Riego ──[lee]──► Perfil de Cultivo (caché flash)
Módulo de Decisión de Riego ──[Pn < umbral → ON + duración]──► Bomba de riego
ESP32 ──[evento ON/OFF + timestamp + duración]──► Buffer offline (flash)
```

- Frecuencia: cada 1–5 minutos (configurable, 5 min por defecto)
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
ESP32 ──[POST /api/v1/readings, HTTPS, X-API-Key]──► FastAPI
ESP32 ──[POST /api/v1/events, HTTPS, X-API-Key]──► FastAPI
FastAPI ──[INSERT]──► TimescaleDB
```

- Frecuencia: cada 5 minutos en modo normal
- Si no hay WiFi: las lecturas se acumulan en el Buffer offline y se reenvían en orden al reconectar (FR-06)
- Payload de `/readings`: `{ unit_id, timestamp, temperature, humidity, light, co2 }` — el nivel de tanque no se incluye en readings
- Payload de `/events`: `{ unit_id, timestamp, action, duration_seconds, trigger }`

### F3 — Alerta crítica (envío inmediato, sin esperar timer)

```
ESP32 ──[detecta condición crítica]──► ESP32
ESP32 ──[POST /api/v1/alerts, HTTPS, X-API-Key, inmediato]──► FastAPI
FastAPI ──[INSERT alerts]──► TimescaleDB
FastAPI ──[HTTP a Telegram API]──► Bot de Telegram ──► Usuario
```

- Condiciones que disparan envío inmediato: tanque bajo (flotador 30% en aire), sensor desconectado, fallo de bomba
- El server guarda la alerta en DB y dispara la notificación de Telegram en el mismo flujo
- Si no hay salida a internet, la alerta queda en DB con `status = pending` y se envía al reconectar (FR-37)

### F4 — Polling de comandos y perfil (ESP32 → server, cada ciclo)

```
ESP32 ──[GET /api/v1/units/{unit_id}/commands, HTTPS, X-API-Key]──► FastAPI
FastAPI ──[SELECT comandos pendientes]──► TimescaleDB
FastAPI ──[lista de comandos]──► ESP32
ESP32 ──[ejecuta: pump_on / pump_off / pause_autonomous / update_profile / valve_open / valve_close]──► Bomba, Válvula NC o Perfil de Cultivo (flash)

ESP32 ──[GET /api/v1/units/{unit_id}/profile, HTTPS, X-API-Key]──► FastAPI
FastAPI ──[SELECT perfil activo]──► TimescaleDB
FastAPI ──[perfil de cultivo]──► ESP32
ESP32 ──[guarda]──► Perfil de Cultivo (caché flash)
```

- Latencia máxima de un comando: 1–5 minutos (el override no es acción de emergencia, FR-19)
- El ESP32 marca cada comando como consumido (`consumed_at`) al procesarlo

### F5 — OTA (Over The Air firmware update)

```
ESP32 ──[GET /api/v1/firmware/latest, HTTPS, X-API-Key]──► FastAPI
FastAPI ──[{ version, download_url, hash }]──► ESP32
ESP32 ──[si versión > instalada: descarga binario]──► FastAPI
ESP32 ──[verifica hash de integridad]──► ESP32
ESP32 ──[reinicia con nuevo firmware / rollback si falla]──► ESP32
```

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
ESP32 ──[próximo ciclo de polling]──► FastAPI ──[comando]──► ESP32
ESP32 ──[ejecuta override]──► Bomba
```

### F8 — Gestión de perfiles de cultivo

```
Navegador ──[POST /api/v1/profiles, Bearer JWT]──► FastAPI ──[INSERT]──► TimescaleDB
Navegador ──[PUT /api/v1/units/{id}/profile, Bearer JWT]──► FastAPI
FastAPI ──[encola update_profile en commands]──► TimescaleDB
ESP32 ──[polling]──► FastAPI ──[nuevo perfil]──► ESP32 ──[guarda en flash]──► Perfil de Cultivo (caché flash)
```

### F9 — Simulador (reemplaza al ESP32 en desarrollo)

```
Simulator ──[POST /api/v1/readings, HTTPS, X-API-Key]──► FastAPI  (idéntico a F2)
Simulator ──[POST /api/v1/events, HTTPS, X-API-Key]──► FastAPI    (idéntico a F2)
Simulator ──[GET /api/v1/units/{id}/commands, HTTPS, X-API-Key]──► FastAPI  (idéntico a F4)
```

---

## Autenticación — resumen

| Actor | Mecanismo | Header |
|---|---|---|
| ESP32 → API | API key por unidad (única, generada al registrar) | `X-API-Key: <clave>` |
| Simulator → API | Misma API key que un ESP32 | `X-API-Key: <clave>` |
| Dashboard → API | JWT (expira en ~1h) + refresh token de larga duración | `Authorization: Bearer <jwt>` |

---

## Ciclo de vida del Perfil de Cultivo Activo

El perfil es el nexo entre la Capa 2 y la lógica de decisión de la Capa 1:

```
1. Usuario crea/edita perfil → dashboard → POST/PUT /api/v1/profiles → TimescaleDB
2. Usuario asigna perfil a unidad → dashboard → PUT /api/v1/units/{id}/profile → FastAPI
3. FastAPI encola comando update_profile en tabla commands
4. ESP32 en próximo ciclo → GET /api/v1/units/{id}/commands → recibe update_profile
5. ESP32 descarga perfil → GET /api/v1/units/{id}/profile
6. ESP32 guarda en flash (sobreescribe anterior)
7. Módulo de Decisión de Riego usa el nuevo perfil desde ese momento
8. Sin conexión: ESP32 sigue usando el último perfil conocido en flash
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
| Algoritmo ML para estimación de Pn (SVR, BPNN, ANN, otro) | La inferencia corre en el ESP32 como modelo `.tflite`. La selección del algoritmo afecta el entrenamiento en `ml/` y el tamaño del modelo exportado, pero no cambia la topología del diagrama. |
| Función Pn → duración del ciclo de riego | Interna al Módulo de Decisión de Riego; no cambia la topología del diagrama |
| Buffer/reintento del ESP32 (tamaño, política de descarte) | Interna a la Capa 1; no cambia la topología |
