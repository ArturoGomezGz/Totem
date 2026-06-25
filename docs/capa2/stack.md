# Stack técnico

Decisiones de stack cerradas. Para decisiones pendientes ver [Notion — Requerimientos](https://app.notion.com/p/3839cfa57faf80db8999dd0349729ea0).

---

## Backend — FastAPI (Python)

**Estado:** decidido · 20 jun 2026

**Decisión:** el server (Capa 2) se construye con FastAPI.

**Razones:**

- **Replicabilidad (NFR-15):** FastAPI es liviano y corre sin problema en Raspberry Pi — un tercero puede levantar su propia instancia en hardware básico sin depender de infraestructura cloud costosa. Frameworks más pesados comprometen este requisito.
- **Mismo lenguaje que `ml/` y `simulator/`:** permite compartir código de utilidades (validación de lecturas, tipos de datos) entre los tres módulos sin fricciones.
- **Validación y contrato de API automáticos:** Pydantic valida los payloads del ESP32 en el punto de entrada; OpenAPI genera la documentación del contrato dispositivos ↔ server sin esfuerzo extra — clave para replicabilidad.
- **Velocidad de desarrollo:** el equipo ya tiene experiencia con FastAPI, lo que reduce el tiempo de prototipado en una etapa donde el stack aún se está validando.
- **Sin overhead innecesario:** el dashboard usa polling simple cada 30–60s (NFR-02) — no se necesita WebSocket ni streaming; FastAPI cubre exactamente lo que el sistema requiere sin añadir complejidad.

**Pendiente de decidir dentro del stack Python:** nada — stack Python completamente cerrado.

---

## ORM — SQLAlchemy (modo sync)

**Estado:** decidido · 20 jun 2026

**Decisión:** SQLAlchemy en modo síncrono (no async).

**Razones:**

- **Async no aporta valor en el MVP:** el tráfico real de Totem es esporádico — ESP32 enviando lecturas cada 1–5 min, dashboard con polling cada 30–60s, pico máximo de decenas de unidades simultáneas. SQLAlchemy sync maneja ese volumen sin problema de rendimiento.
- **Sin configuración adicional:** async con SQLAlchemy requiere un driver separado (`asyncpg`), configuración de pool async, y que cada función en la cadena de llamadas sea async. Esa configuración no compra nada concreto en este contexto — es overhead puro.
- **Sin complejidad innecesaria:** mezclar sync y async accidentalmente produce bugs sutiles y difíciles de depurar. Mantener todo sync elimina esa clase de error por completo y hace el código más legible para terceros que quieran replicar o contribuir.
- **La única ventaja de async (concurrencia bajo IO intensivo) no aplica aquí:** no hay endpoints de streaming, no hay llamadas a APIs externas en el camino crítico, no hay miles de conexiones simultáneas.

**Cómo escalar a async si el sistema lo requiere en el futuro:**
SQLAlchemy soporta async de forma nativa — la migración es quirúrgica, no un rediseño. El momento correcto para hacerla es cuando haya un problema de rendimiento medible: cientos de unidades enviando datos simultáneamente, o la adición de endpoints de streaming (Server-Sent Events). No antes.

> **Regla:** no introducir async en ningún módulo del server hasta que haya un caso de uso concreto que lo justifique.

---

## Base de datos — TimescaleDB

**Estado:** decidido · 20 jun 2026

**Decisión:** una sola base de datos TimescaleDB para todo el sistema — lecturas de sensores (series de tiempo) y metadatos relacionales (unidades Totem, perfiles de cultivo, usuarios, alertas).

**Razones:**

- **Es PostgreSQL:** no es un sistema nuevo — es una extensión de Postgres. Curva de aprendizaje cero, SQLAlchemy lo trata igual, cualquier persona con conocimiento de Postgres puede operarlo.
- **Una sola DB para todo (NFR-15):** TimescaleDB maneja eficientemente tanto las hypertables de series de tiempo (lecturas de sensores a 1–5 min de frecuencia) como las tablas relacionales convencionales. No hay necesidad de un segundo sistema — simplifica el deploy y la documentación para terceros que quieran replicar.
- **Escalabilidad en series de tiempo sin gestión manual:** particionado automático por tiempo (hypertables), downsampling nativo y queries de ventana temporal rápidas — lo que Postgres puro requeriría gestionar con índices cuidadosos a medida que la tabla de lecturas crece.
- **Imagen Docker oficial:** `timescale/timescaledb` — un servicio más en el `docker-compose`, sin infraestructura adicional.

**Alternativas descartadas:**
- **InfluxDB:** propósito específico para series de tiempo pero no relacional — requeriría un segundo sistema para metadatos, lo que contradice NFR-15.
- **PostgreSQL puro:** viable pero requiere gestión manual de índices y particionado cuando la tabla de lecturas crece. TimescaleDB lo resuelve sin costo adicional de operación.
- **SQLite:** no maneja escrituras concurrentes (ESP32 + dashboard + simulator simultáneos).

---

## Broker MQTT — Mosquitto

**Estado:** decidido · 23 jun 2026

**Decisión:** el broker MQTT del sistema es Eclipse Mosquitto.

**Razones:**

- **Liviano:** corre sin problema en Raspberry Pi — un contenedor Docker con uso de memoria mínimo.
- **Imagen Docker oficial:** `eclipse-mosquitto` — un servicio más en el `docker-compose`, sin infraestructura adicional.
- **Soporte TLS nativo:** MQTTS (puerto 8883) sin dependencias externas.
- **Autenticación por credenciales:** Mosquitto valida usuario/contraseña en el handshake MQTT — suficiente para el modelo de API key por unidad.
- **Madurez y adopción:** broker de referencia para IoT embebido; documentación amplia, sin sorpresas operativas.

**Rol en el sistema:** punto de entrada de todos los dispositivos ESP32. FastAPI se suscribe a los topics de lecturas, eventos y alertas para persistirlos; publica a los topics de comandos, perfiles y OTA para controlar dispositivos.

**Autenticación dinámica:** Mosquitto delega la validación de credenciales a FastAPI via el plugin `mosquitto-go-auth` con backend HTTP. Cuando un dispositivo intenta conectar, Mosquitto llama a un endpoint interno de FastAPI que consulta la base de datos y responde si las credenciales son válidas. La DB es la única fuente de verdad — dar de alta o revocar una unidad es una operación en la DB, sin tocar archivos ni reiniciar Mosquitto. Ver flujo completo en `docs/capa2/api-contract.md`.

**Pendiente de decidir dentro del stack Mosquitto:** configuración de sesiones persistentes (clean session vs. persistent session) — afecta el comportamiento del buffer offline al reconectar.

---

## Convenciones de API

**Estado:** decidido · 20 jun 2026

**Prefijo:** todos los endpoints usan `/api/v1/`.

**Razón principal para versionar:** el ESP32 tiene los endpoints hardcodeados en su firmware. Si el contrato de API cambia en el futuro (formato de payload, estructura de respuesta), se introduce `/api/v2/` manteniendo `/api/v1/` activo para unidades en campo que aún no recibieron OTA. Sin versión, cualquier cambio de contrato rompe todos los clientes simultáneamente sin posibilidad de migración gradual.

Ver contrato completo de endpoints, payloads y autenticación en `docs/capa2/api-contract.md`.

---

## Frontend — React + Vite

**Estado:** decidido · 20 jun 2026

**Decisión:** el dashboard web se construye con React + Vite.

**Razones:**

- **Escalabilidad sin límite:** React es el framework frontend más adoptado — ecosistema amplio de librerías de gráficas (Recharts, Chart.js), componentes y documentación. El dashboard puede crecer en complejidad sin cambiar de tecnología.
- **Reemplazable por diseño:** el frontend consume la API REST de Capa 2 y no tiene acoplamiento con el server. Si en el futuro se decide migrar a otra tecnología, es un reemplazo quirúrgico sin tocar el backend.
- **Puerta abierta a React Native:** si en el futuro se decide construir una app móvil nativa, React Native comparte familiaridad y lógica de negocio con React web. La decisión queda diferida hasta confirmar si las notificaciones push via bot de Telegram son suficientes en la práctica.
- **Vite:** build pipeline moderno, rápido y sin configuración compleja — reduce la fricción de setup para terceros que quieran contribuir.

---

## Notificaciones — Bot de Telegram

**Estado:** decidido · 20 jun 2026

**Decisión:** canal principal de notificaciones y control remoto via bot de Telegram.

**Razones:**

- **Cero infraestructura adicional:** un bot de Telegram es una llamada HTTP a la API de Telegram. No agrega ningún servicio al docker-compose ni requiere configuración de certificados push o proveedores de email.
- **Funciona en cualquier entorno de deployment:** solo necesita que el server tenga salida a internet — no requiere IP pública, dominio, ni port forwarding. En el deployment más común (RPi en red local doméstica o de campo), el bot sigue siendo accesible desde cualquier lugar del mundo porque **es el server quien inicia la conexión hacia Telegram**, no al revés. El dashboard web queda limitado a la red local; el bot no.
- **Bidireccional desde el día uno:** además de recibir alertas, el usuario puede enviar comandos al sistema desde el chat — override de bomba, consulta de estado, cambio de perfil de cultivo — sin necesidad de abrir el dashboard.
- **Sin fricción para el usuario:** Telegram ya está instalado; no hay app adicional que instalar ni cliente de notificaciones que configurar.

**Capacidades del bot:**

Notificaciones pasivas: alertas críticas (tanque bajo, sensor desconectado, fallo de bomba), resumen periódico del sistema.

Comandos activos: `/status` (estado actual de unidades), `/bomba on|off` (override manual), `/perfil [especie]` (cambiar perfil de cultivo), `/lecturas` (últimas lecturas de sensores).

**Limitación de deployment:** en entornos sin salida a internet, el bot no funciona. Esto es una limitación de deployment, no un bug de diseño — los requerimientos lo contemplan explícitamente (FR-21). El riego (Capa 1) sigue operando con normalidad.

**Email descartado para el MVP:** requiere SMTP, credenciales y proveedor externo — complejidad innecesaria cuando Telegram cubre todos los casos de uso de notificación.
