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
| `/estado [unidad]` | Online/offline (basado en `last_seen`), última lectura de temperatura/humedad/luz, versión de firmware actual | `Unit`, `Reading` |
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

- pH y nivel de tanque en `/estado` — no existen todavía en el modelo `Reading` (que hoy solo tiene temperature, humidity, light); no se puede mostrar un dato que no se mide.
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

Tanque padre elevado físicamente sobre el Totem que abastece agua por gravedad — sin bomba en el tanque padre. El Totem controla su propia entrada mediante la válvula NC ya implementada. Compatible con la Capa 1 sin cambios de código — la integración física es una manguera. Ver `docs/capa1/tanque-de-suministro/sistema-tanque-suministro.md` para el diseño completo.

## Cálculo automático de rango EC/pH sugerido

**Contexto:** `supply_tank_configs.ph_min/max` y `ec_min/max` (ver `capa2/schema.md`) son manuales — el admin los define explícitamente al configurar el tanque. Se decidió así (9 jul 2026) porque un tanque tiene una única composición física de solución, y no existe forma de derivar automáticamente un rango correcto si abastece totems con cultivos de necesidades muy distintas (ej. hoja verde ~0.8–1.2 mS/cm de EC vs. frutales ~2.0–3.5 mS/cm — rangos que no se solapan). Investigación y fuentes en `capa1/tanque-de-suministro/sistema-tanque-suministro.md`.

**Feature futura:** un módulo de *sugerencia* (no de escritura automática) que, dado un tanque padre, calcule el rango de EC/pH más adecuado a partir de los perfiles de cultivo de los totems que abastece (via `totem_configs.supply_tank_id`).

**Principio de diseño — vive sobre el esquema, no lo determina.** Este módulo es una capa de aplicación que lee datos ya existentes y sugiere un valor; el admin sigue siendo quien decide y confirma el valor final en `supply_tank_configs`. El esquema no se diseña en función de este módulo — el módulo se adapta al esquema ya cerrado.

**Prerrequisito de esquema (extensión simple, mismo patrón ya usado):** `crop_profiles` hoy no tiene campos de EC/pH — solo rangos ambientales (`temp_min/max`, `humidity_min/max`, `light_min/max`) para el módulo de decisión de riego. Habría que añadir `ec_min/max` y `ph_min/max` nullable a `crop_profiles`, siguiendo el mismo patrón de rangos nullable que ya existe en esa tabla — no es un cambio estructural nuevo, solo más columnas del mismo tipo.

**Lógica propuesta:**
1. Encontrar todos los `totem_configs` con `supply_tank_id = <tanque>` y `active_profile_id IS NOT NULL`.
2. Obtener `ec_min/max` y `ph_min/max` de cada `crop_profile` asociado.
3. Calcular la **intersección** de los rangos (`max(mins)`, `min(maxes)`) — no un promedio. Un promedio daría un valor que no es óptimo para ningún cultivo; la intersección es el único rango que efectivamente sirve a todos simultáneamente.
4. Si la intersección es vacía (cultivos incompatibles, ej. lechuga + tomate en el mismo tanque), el módulo debe **advertir explícitamente la incompatibilidad**, no sugerir un valor engañoso — es información valiosa para el usuario (indica que debería separar esos cultivos en tanques distintos, o aceptar un compromiso consciente).
5. El resultado es una sugerencia que el admin puede aceptar (prellenar `supply_tank_configs`) o ignorar — nunca se escribe automáticamente sin confirmación.

No es parte del MVP del tanque de suministro (que en sí mismo tampoco es MVP del sistema, ver estado en `sistema-tanque-suministro.md`). Se documenta ahora para no perder el razonamiento de diseño de cara a una iteración futura.

## Mezcla dinámica entre múltiples tanques padre (idea capturada, no diseñada)

**Contexto:** con FR-43 (pH/EC medidos en el propio tanque del Totem, 9 jul 2026), se abre la puerta conceptual a un escenario más avanzado: dos o más tanques padre con composiciones de solución distintas (ej. EC/pH diferentes), y el Totem combinando el aporte de cada uno — vía dos válvulas en vez de una, con control proporcional o pulsos calculados — para converger a un valor objetivo en su propio tanque, usando la lectura de pH/EC del Totem como retroalimentación.

**Estado: idea, no diseño.** Explícitamente no se ha decidido nada sobre esto — se documenta solo para no perder el razonamiento la próxima vez que se retome. Antes de diseñarlo en serio habría que resolver al menos:

- Nueva categoría de actuador en el Totem (hoy solo controla bomba y una válvula NC de agua) — dos válvulas de entrada implica lógica de control distinta, posiblemente válvulas proporcionales en vez de todo-o-nada
- Lógica de control de lazo cerrado (usar la lectura de pH/EC del propio Totem para decidir cuánto abrir cada válvula) — bastante más complejo que la lógica actual de "abrir/cerrar según flotador"
- Si el costo/complejidad adicional se justifica frente a simplemente tener más tanques padre especializados (uno por tipo de cultivo) sin mezcla dinámica

Es una dirección de escalamiento genuinamente valiosa (es, en esencia, el patrón de dosificación proporcional A/B/C que usan sistemas de fertirriego comerciales), pero es una categoría de proyecto distinta a "agregar un sensor" — se retoma cuando haya evidencia real de que se necesita.
