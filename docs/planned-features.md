# Features planificadas

Funcionalidades identificadas como valiosas que quedan fuera del alcance del MVP. No son requerimientos formales — no tienen número de FR. Cuando llegue el momento de implementar alguna, se formaliza en `docs/requirements.md` con sus FR correspondientes.

---

## Bot de Telegram — comandos de solo lectura

El bot del MVP solo envía notificaciones pasivas y tiene dos comandos de gestión de cuenta (`/vincular`, `/desvincular`); no tiene ningún comando de consulta. Una iteración futura añadiría comandos de solo lectura para que el usuario vea lo más importante del sistema desde el chat, sin escribir nada todavía (comandos de escritura — forzar bomba, cambiar perfil — quedan para una iteración posterior, ver sección siguiente).

### Estado actual del bot (contexto para la implementación)

- Arquitectura: polling loop propio (`server/telegram/bot.py`), sin librería tipo python-telegram-bot/aiogram. Corre en un thread daemon dentro del mismo proceso de FastAPI (arrancado/parado en `server/main.py` vía el `lifespan`).
- Ruteo de comandos: un `if/elif` sobre el texto entrante (`_handle_update`). No escala bien — antes de sumar varios comandos conviene refactorizar a un dispatcher (`dict[str, handler]`).
- Vinculación: `TelegramUser` liga `user_id` (usuario del sistema) ↔ `chat_id` de Telegram — es 1 usuario = 1 chat, **no** hay vínculo directo a una organización o unidad específica. La resolución a organización pasa siempre por `Membership` (usuario → memberships → organizaciones → unidades).
- Implicación de diseño: un usuario puede tener varias organizaciones y cada una varias unidades, así que casi cualquier comando de consulta necesita resolver "¿de cuál unidad hablamos?". Propuesta: `/unidades` lista las unidades accesibles (vía join a `Membership`); el resto de comandos aceptan un argumento opcional de nombre/id de unidad y, si el usuario solo tiene una unidad, se usa esa por defecto sin pedirlo.
- Cualquier comando nuevo debe filtrar explícitamente por pertenencia (join a `Membership`) — hoy no existe ninguna verificación de que el chat que pregunta tenga permiso sobre la unidad consultada, porque no hacía falta (solo hay comandos de vinculación).
- Limitaciones técnicas a tener en cuenta: no hay backoff de rate limit de Telegram (poll fijo cada 3s, `getUpdates` con `timeout=1` corto en vez de long-polling de 30-60s), cada mensaje abre su propia sesión de DB (sin pool async), y los errores solo se logean con `print()`.

### Comandos propuestos

**Núcleo (alto valor, datos ya existentes en el ORM — candidatos a primera implementación):**

| Comando | Qué muestra | Fuente de datos |
|---|---|---|
| `/estado [unidad]` | Online/offline (basado en `last_seen`), última lectura de temperatura/humedad/luz/CO2, versión de firmware actual | `Unit`, `Reading` |
| `/unidades` | Lista de unidades accesibles por el usuario con estado resumido (🟢/🔴) | `Unit` + `Membership` |
| `/alertas [unidad]` | Alertas activas (no resueltas) con severidad y mensaje | `Alert` |
| `/perfil [unidad]` | Perfil de cultivo activo: rangos min/max configurados vs. lecturas actuales | `CropProfile`, `TotemConfig`, `Reading` |

**Segundo nivel (útil, algo más de trabajo):**

| Comando | Qué muestra | Fuente de datos |
|---|---|---|
| `/historial [unidad]` | Últimos N eventos de dispositivo (riegos automáticos, etc.) | `DeviceEvent` |
| `/comandos [unidad]` | Últimos comandos manuales enviados y si fueron entregados | `Command` |
| `/firmware [unidad]` | Versión actual vs. release objetivo/disponible | `Unit`, `FirmwareRelease` |

**Cuestionables — evaluar antes de implementar:**

- `/tendencia [unidad]` — enviar una gráfica (imagen) de las últimas horas de una variable. Alto valor visual pero requiere generar imágenes (matplotlib/plotly) desde el bot, más complejidad que el resto de comandos.
- `/ayuda` — lista de comandos disponibles. Trivial, pero solo vale la pena una vez existan 3+ comandos.

**Explícitamente fuera de alcance por ahora:**

- pH y nivel de tanque en `/estado` — no existen todavía en el modelo `Reading` (que hoy solo tiene temperature, humidity, light, co2); no se puede mostrar un dato que no se mide.
- Resúmenes automáticos diarios/semanales — es un tipo de notificación push (cron + `notify_*`), no un comando de consulta; feature separada que no bloquea esta lista.

### Prioridad sugerida para una primera iteración

`/estado`, `/unidades` y `/alertas` cubren el caso de uso principal ("qué pasa con mi cultivo ahora mismo") sin tocar generación de gráficas ni historiales largos. `/perfil`, `/historial`, `/comandos` y `/firmware` quedan como segunda ronda.

## Bot bidireccional de Telegram (comandos de escritura)

Una vez validados los comandos de solo lectura de la sección anterior, una iteración posterior añadiría comandos de escritura: forzar encendido/apagado de la bomba, cambiar el perfil de cultivo activo. Esto convertiría el bot en una interfaz alternativa al dashboard — especialmente útil cuando el dashboard no es accesible fuera de la red local. Requiere resolver además autenticación/autorización más estricta que la de solo lectura, dado que estos comandos tienen efecto físico sobre el sistema.

## Estrategia de versionamiento del firmware

A medida que el sistema escale a múltiples unidades en campo con distintas versiones de firmware instaladas, será necesario definir cómo el backend gestiona la compatibilidad: qué versiones de firmware son compatibles con qué versiones de la API, cómo se comunican los cambios de contrato, y hasta dónde atrás se mantiene compatibilidad. No urgente en el MVP, crítico cuando haya unidades en campo que no se pueden actualizar simultáneamente.

## App móvil nativa

Si la combinación de dashboard web responsive y bot de Telegram resultara insuficiente para el uso móvil, una app nativa permitiría notificaciones push nativas y una experiencia más fluida en celular. Dado que el frontend ya es React, React Native sería la opción natural por la familiaridad compartida y la reutilización de lógica de negocio.

## Despliegue en Railway (servidor remoto)

El servidor está diseñado como deployment-agnostic y puede levantarse en Railway sin cambios de código — solo variables de entorno. La discusión técnica está en la sección siguiente.

### Qué funciona sin cambios

- API REST, WebSocket, dashboard frontend
- OTA: el ESP32 descarga el `.bin` por HTTP/HTTPS desde `SERVER_URL` (URL pública de Railway)
- Telegram: es HTTP saliente desde el servidor, sin dependencias de red entrante
- Base de datos: Railway soporta PostgreSQL nativo

### El único bloqueante: MQTT

Railway expone HTTP/HTTPS automáticamente pero no enruta TCP puro (puerto 1883). Dos opciones:

**Opción A — Broker MQTT externo (recomendada para empezar)**
Usar HiveMQ Cloud o EMQX Cloud en su tier gratuito. El broker vive en la nube, el servidor en Railway se conecta a él con las variables `MQTT_*`, y los ESP32 también. Solo requiere:
- Cambiar las variables `MQTT_*` en el `.env` de Railway
- Re-provisionar el NVS de los ESP32 con la nueva `mqtt_uri`

**Opción B — MQTT sobre WebSocket**
Mosquitto puede escuchar en un puerto WebSocket además de TCP. `esp-mqtt` soporta `ws://`. Railway puede proxiar WebSocket. Más complejo de configurar.

### Pasos para el despliegue

1. Crear proyecto en Railway, conectar el repositorio
2. Agregar todas las variables del `deploy/.env.example` en el panel de Railway
3. Elegir broker MQTT (Opción A recomendada)
4. Actualizar `SERVER_URL` con la URL pública de Railway (`https://tu-app.railway.app`)
5. Re-provisionar NVS de los ESP32 con la nueva `mqtt_uri`
6. Verificar OTA: la descarga del `.bin` es HTTPS — revisar si el `ota_task` del firmware necesita el certificado raíz de Let's Encrypt o si se puede deshabilitar verificación SSL para la descarga

### Implicaciones para los ESP32

| Variable NVS | Valor local | Valor Railway |
|---|---|---|
| `mqtt_uri` | `mqtt://192.168.x.x:1883` | URI del broker externo |
| `api_key` | Sin cambio | Sin cambio |
| `unit_id` | Sin cambio | Sin cambio |

No es necesario recompilar el firmware — solo re-provisionar NVS con la nueva URI del broker.

---

## Sistema de Abastecimiento por Gravedad

Tanque padre elevado físicamente sobre el Totem que abastece agua por gravedad — sin bomba en el tanque padre. El Totem controla su propia entrada mediante la válvula NC ya implementada. Compatible con la Capa 1 sin cambios de código — la integración física es una manguera. Ver `docs/gravity-feed.md` para el diseño completo.
