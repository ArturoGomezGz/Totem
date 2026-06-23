# Requerimientos del sistema

Requerimientos funcionales (FR) y no funcionales (NFR) del sistema Totem v1.0 MVP.

**Numeración:** los FR se numeran de forma continua en el orden en que se definen, sin reiniciar por sección ni por versión. Si en el futuro se agregan requerimientos a una sección ya cerrada, los nuevos números continúan desde el último global — los gaps en la numeración son aceptables y esperados.

---

## Índice

| Sección | FRs |
|---|---|
| FR — Firmware (Capa 1) | FR-01 – FR-12 |
| FR — Backend / API (Capa 2) | FR-13 – FR-21 |
| FR — Frontend (dashboard web) | FR-22 – FR-35 |
| FR — Bot de Telegram | FR-36 – FR-38 |
| FR — Válvula de Entrada y Nivel de Tanque | FR-39 – FR-42 |
| NFR | NFR-01 – NFR-20 |

**v1.0 MVP — estado: en desarrollo**

---

## Requerimientos funcionales (FR)

> Los FR describen **qué debe hacer** el sistema — comportamientos observables, acciones que el sistema ejecuta, funciones que expone al usuario o a otros componentes.

### FR — Firmware (ESP32, Capa 1) · FR-01 a FR-12

**Ciclo de operación principal**

- FR-01: El sistema debe leer todos los sensores configurados en intervalos de 1 a 5 minutos de forma continua y autónoma
- FR-02: Con cada lectura de sensores, el Módulo de Decisión de Riego (ver `docs/capa1/totem-principal/sistema-decision/modulo-decision.md`) debe determinar autónomamente si activar la bomba y por cuánto tiempo, en función del perfil de cultivo activo (ver `docs/transversal/crop-profile.md`) — sin intervención humana
- FR-03: La decisión de riego y la duración del ciclo deben ser determinadas por el Módulo de Decisión de Riego — no son valores fijos ni configurados manualmente en el firmware
- FR-04: El sistema debe registrar localmente cada evento de actuación de la bomba (ON/OFF) con timestamp y duración del ciclo

**Buffer y conectividad**

- FR-05: El sistema debe enviar cada lectura de sensores y evento de riego al server (Capa 2) tan pronto como haya conexión disponible
- FR-06: Si no hay conexión, el sistema debe almacenar las lecturas en un buffer local (flash del ESP32) y reenviarlas en orden al reconectar
- FR-07: El sistema debe cachear localmente el perfil de cultivo activo para que el Módulo de Decisión de Riego pueda seguir operando aunque no haya conexión con el server (Capa 2)

**Configuración inicial**

- FR-08: El sistema debe permitir configurar las credenciales WiFi sin necesidad de reprogramar el dispositivo — mediante un mecanismo accesible para usuarios sin experiencia técnica (ej. portal cautivo desde el celular)
- FR-09: El ESP32 debe mantener una conexión persistente con el broker MQTT y recibir comandos (override, cambio de perfil) por suscripción — sin polling. Latencia de entrega: milisegundos desde que el server publica el comando
- FR-10: El firmware del ESP32 debe soportar actualizaciones remotas OTA (Over The Air) — el dispositivo verifica si existe una nueva versión disponible en el backend, la descarga, verifica su integridad, y se reinicia con la nueva versión. Debe incluirse en el MVP.

**Alertas desde el dispositivo**

- FR-11: El sistema debe detectar condiciones críticas (nivel de tanque bajo, sensor desconectado, fallo de bomba) y generar una alerta que se envíe al backend para su notificación
- FR-12: 🔴 *Pendiente de definir en detalle: qué condiciones disparan alerta, severidad por evento, y cómo el ESP32 detecta cada condición*

---

### FR — Backend / API (Capa 2) · FR-13 a FR-21

**Ingesta de datos**

- FR-13: El backend debe suscribirse al topic MQTT `totem/{unit_id}/readings` y persistir cada lectura recibida, incluyendo lecturas con timestamp pasado (reenvíos del buffer offline)
- FR-14: El backend debe persistir todas las lecturas recibidas en la base de datos con retención indefinida

**Gestión de dispositivos y perfiles**

- FR-15: El backend debe permitir registrar unidades Totem y asociarlas a una instalación/usuario
- FR-16: El backend debe permitir crear, editar y asignar perfiles de cultivo (ver `docs/transversal/crop-profile.md`) a unidades Totem
- FR-17: El backend debe publicar el perfil de cultivo activo al topic MQTT `totem/{unit_id}/profile` cuando se asigne o actualice una unidad — el ESP32 lo recibe por suscripción y lo cachea en flash

**Override y control manual**

- FR-18: El backend debe exponer un mecanismo para que el dashboard envíe comandos de override a una unidad Totem (forzar bomba ON/OFF, pausar modo autónomo por tiempo definido)
- FR-19: El backend debe publicar comandos al topic MQTT `totem/{unit_id}/commands` con QoS 1 — el ESP32 los recibe por suscripción en milisegundos. El broker garantiza la entrega aunque el dispositivo esté temporalmente desconectado (sesión persistente).
- FR-20: El backend debe alojar los binarios compilados del firmware y exponer un endpoint que indique al ESP32 si existe una versión más reciente que la instalada, junto con la URL de descarga y un hash de verificación de integridad

**Autenticación**

- FR-21: El backend debe autenticar tanto a usuarios (acceso al dashboard) como a dispositivos (ESP32 enviando datos), con control de acceso por instalación

---

### FR — Frontend (dashboard web) · FR-22 a FR-35

**Monitoreo en tiempo real**

- FR-22: El dashboard debe mostrar el estado actual de cada unidad Totem: valores de sensores más recientes (T, RH, Li, CO₂), estado de la bomba, nivel de tanque
- FR-23: El dashboard debe indicar si el sistema está operando en modo autónomo (el Módulo de Decisión de Riego está activo) o en override manual
- FR-24: El dashboard debe actualizarse automáticamente sin recargar la página. Implementación: polling desde el navegador cada 30–60 segundos. Latencia máxima aceptable: menos de 1 minuto.

**Histórico y visualización**

- FR-25: El dashboard debe permitir ver el histórico de lecturas de sensores en gráficas de series de tiempo, con selección de rango de fechas
- FR-26: El dashboard debe permitir ver el historial de eventos de riego (cuándo se activó/apagó la bomba y duración del ciclo) cruzado con los valores de sensores en ese momento
- FR-27: El MVP debe mostrar gráficas históricas de T, RH y eventos de riego. Li y CO₂ se muestran en estado actual pero sin gráfica histórica en el MVP. 🔴 *Por definir: rango de tiempo por defecto de las gráficas*

**Control manual**

- FR-28: El dashboard debe permitir forzar el encendido o apagado de la bomba de forma manual, anulando temporalmente el Módulo de Decisión de Riego
- FR-29: El dashboard debe permitir pausar el modo autónomo por un tiempo definido (ej. "pausar 1 hora")
- FR-30: El dashboard debe indicar claramente cuándo el sistema está en modo override vs. modo autónomo

**Configuración**

- FR-31: El dashboard debe permitir crear y editar perfiles de cultivo y asignarlos al Módulo de Decisión de Riego de cada unidad
- FR-32: El dashboard debe permitir asignar el perfil de cultivo activo a cada unidad Totem y cambiarlo entre cosechas
- FR-33: El dashboard debe permitir configurar el intervalo de lectura de sensores por unidad Totem (dentro de un rango predefinido, ej. 1–10 min)
- FR-34: El dashboard debe permitir configurar umbrales de alerta por unidad (ej. temperatura máxima, nivel mínimo de tanque) independientemente del perfil de cultivo

**Alertas**

- FR-35: El dashboard debe mostrar un historial de alertas generadas, con estado (enviada/pendiente) y timestamp

---

### FR — Bot de Telegram · FR-36 a FR-38

> El bot de Telegram es el canal de notificaciones del sistema. En el MVP su rol es exclusivamente pasivo: notificar al usuario cuando ocurre algo relevante. El server inicia la conexión hacia Telegram — no requiere IP pública ni port forwarding, funciona en cualquier deployment con salida a internet.

- FR-36: El server debe recibir alertas generadas por los ESP32 y disparar notificaciones al usuario vía bot de Telegram cuando haya salida a internet. En entornos sin salida a internet, las alertas se almacenan y quedan visibles en el dashboard.
- FR-37: Las notificaciones no enviadas por falta de conectividad deben encolarse y enviarse al reconectar
- FR-38: El bot debe notificar al menos: tanque bajo, sensor desconectado, fallo de bomba, y resumen periódico del sistema. Telegram es el único canal de notificaciones del MVP — no se implementa email ni push nativo.

---

### FR — Válvula de Entrada y Nivel de Tanque · FR-39 a FR-42

> Válvula solenoide normalmente cerrada (NC) en la entrada de agua y dos flotadores digitales. Parte del MVP, opera completamente local — sin depender de WiFi ni del server.

**Válvula solenoide NC**

- FR-39: El sistema debe incluir una válvula solenoide NC en la tubería de entrada de agua del tanque. Agnóstica a la fuente de agua (tanque padre elevado, llave, manguera u otra fuente con presión positiva)
- FR-40: La válvula debe abrirse automáticamente cuando el flotador de nivel bajo (~30%) queda en el aire (nivel por debajo del umbral)
- FR-41: La válvula debe cerrarse automáticamente cuando el flotador de nivel alto (~90%) se activa. En ausencia de corriente o ante fallo del ESP32, la válvula retorna a su estado natural (cerrada) — el desbordamiento es físicamente imposible sin un fallo activo

**LEDs de indicación**

- FR-42: La unidad física debe incluir dos LEDs: LED rojo (flotador del 30% en el aire — nivel bajo) y LED verde (flotador del 90% sumergido — tanque lleno). Se actualizan en tiempo real sin depender de conectividad.

---

## Requerimientos no funcionales (NFR)

> Los NFR describen **cómo debe comportarse** el sistema — restricciones de calidad, rendimiento, seguridad, usabilidad y mantenibilidad.

### NFR — Rendimiento

- NFR-01: La latencia entre una lectura de sensor y la actuación de la bomba (decisión ejecutada localmente en el ESP32) debe ser menor a 5 segundos
- NFR-02: La latencia máxima entre que el ESP32 envía una lectura y que aparece visible en el dashboard es de menos de 1 minuto. El dashboard puede usar polling simple cada 30–60 segundos desde el navegador; no se necesita WebSocket ni streaming.
- NFR-03: El backend debe responder peticiones del dashboard (estado actual, carga de histórico de 24h) en menos de 3 segundos bajo condiciones normales de carga

### NFR — Disponibilidad y resiliencia

- NFR-04: La función crítica de riego (Capa 1) debe operar con disponibilidad del 100% independiente de la conectividad a internet
- NFR-05: El server/dashboard debe tener disponibilidad mínima del 99% — en entornos cloud implica elegir un proveedor con SLA adecuado; en entornos locales (RPi) implica configurar reinicio automático ante fallos y alimentación estable.
- NFR-06: Caídas de pocas horas son inaceptables para el usuario. El riego sigue funcionando (Capa 1 es local), pero la visibilidad y las alertas quedan interrumpidas.

### NFR — Seguridad

- NFR-07: Todas las comunicaciones entre el ESP32 y el broker MQTT deben ir cifradas (MQTT sobre TLS — MQTTS, puerto 8883). Las comunicaciones HTTP entre el ESP32 y el server (descarga de binarios OTA) deben ir cifradas (HTTPS/TLS).
- NFR-08: Cada dispositivo ESP32 debe autenticarse ante el backend con credenciales únicas por unidad
- NFR-09: El acceso al dashboard debe requerir autenticación de usuario; cada usuario solo puede ver y controlar sus propias instalaciones
- NFR-10: La revocación de acceso de dispositivos individuales no es un requerimiento del MVP — la seguridad se cubre con credenciales únicas por unidad (NFR-08).

### NFR — Usabilidad

- NFR-11: La configuración inicial de WiFi del ESP32 debe poder completarla una persona sin experiencia técnica en menos de 10 minutos
- NFR-12: El dashboard debe ser usable desde un navegador móvil (responsive), además de escritorio
- NFR-13: El dashboard se desarrolla inicialmente en español, con i18n desde el inicio — los strings de la interfaz no deben estar hardcodeados en el código.
- NFR-14: El dashboard es una web estándar que requiere conexión — no se requiere modo offline (PWA).

### NFR — Mantenibilidad y replicabilidad

- NFR-15: El stack del server (Capa 2) debe poder desplegarse con un proceso documentado y reproducible (Docker Compose o equivalente) — cualquier tercero técnico debe poder levantar su propia instancia en Raspberry Pi, VPS o cloud sin cambios de código.
- NFR-16: El firmware del ESP32 debe soportar actualizaciones OTA — incluido en el MVP, ya que sin esto escalar a múltiples instalaciones remotas es inviable
- NFR-17: El OTA debe incluir verificación de integridad del binario (hash) antes de instalarlo — pendiente definir si también se requiere verificación de origen (firma criptográfica)
- NFR-18: La estrategia de versionado del firmware y compatibilidad hacia atrás con versiones anteriores del backend queda diferida — ver `docs/planned-features.md`
- NFR-19: Una actualización OTA fallida no debe dejar el ESP32 en estado irrecuperable — debe hacer rollback automático a la versión anterior si el nuevo firmware no arranca correctamente

### NFR — Costo operativo

- NFR-20: El costo operativo del server (Capa 2) por instalación debe ser lo suficientemente bajo para no comprometer la viabilidad económica del sistema para un tercero que lo replique.
