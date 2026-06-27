# Features planificadas

Funcionalidades identificadas como valiosas que quedan fuera del alcance del MVP. No son requerimientos formales — no tienen número de FR. Cuando llegue el momento de implementar alguna, se formaliza en `docs/requirements.md` con sus FR correspondientes.

---

## Bot bidireccional de Telegram

El bot del MVP solo envía notificaciones pasivas. Una iteración futura añadiría comandos desde el chat: consultar el estado actual de cada unidad, forzar encendido/apagado de la bomba, cambiar el perfil de cultivo activo, ver las últimas lecturas de sensores. Esto convertiría el bot en una interfaz alternativa al dashboard — especialmente útil cuando el dashboard no es accesible fuera de la red local.

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
