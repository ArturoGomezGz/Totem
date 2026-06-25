# Requerimientos de Base de Datos

**Elaborado por:** análisis de documentación del proyecto  
**Fecha:** 25 jun 2026  
**Propósito:** insumo para el experto en base de datos que revisará la normalización y generará los queries SQL definitivos  
**Fuente de verdad:** este documento refleja el estado actual del esquema en `docs/capa2/schema.md` y todo lo descrito en `docs/requirements.md`, `docs/capa2/api-contract.md`, `docs/capa2/stack.md`, `docs/ecosistema/overview.md` y documentos de Capa 1.

---

## 1. Qué necesita la base de datos desde la perspectiva del sistema

Totem es un sistema de riego aeropónico autónomo con dos capas. La base de datos es exclusiva de Capa 2 (server) y cumple tres roles simultáneos:

1. **Registro histórico de series de tiempo:** almacena las lecturas continuas de sensores (T, RH, Li, CO₂) que llegan de cada ESP32 cada 1–5 minutos. Es el dato operacional de mayor volumen.

2. **Fuente de verdad de configuración:** almacena perfiles de cultivo, credenciales de dispositivos y asignaciones que el ESP32 consume (los cachea en flash). La DB es el punto de alta y revocación de cualquier unidad del sistema.

3. **Registro de auditoría y alertas:** historial de comandos enviados, eventos de actuadores y alertas críticas generadas. No es datos de control en tiempo real — es trazabilidad posterior.

La Capa 1 (ESP32) opera sin depender de la DB. La DB no está en el camino crítico del riego. Los datos que llegan a la DB son el resultado de lo que ya hizo el ESP32 — nunca el input de una decisión de tiempo real.

---

## 2. Flujos críticos que la DB debe soportar

### 2.1 Alta de dispositivo (provisioning)

**Actores:** admin del dashboard → FastAPI → DB → Mosquitto  
**Flujo:**
1. Admin crea una unidad desde el dashboard (`POST /api/v1/units`)
2. FastAPI genera `unit_id` (UUID) y `api_key` (token aleatorio) y los inserta en `units`
3. Si el tipo es `totem`, se inserta también un registro en `totem_configs` (1:1 con `units`)
4. El dashboard muestra las credenciales para que el admin las flashee en el ESP32
5. En cada intento de conexión del ESP32, Mosquitto llama a `POST /api/internal/mqtt/auth` — FastAPI consulta la DB buscando una `units` con ese `unit_id`, `api_key` y `is_active = true`

**Operaciones requeridas:**
- `INSERT` en `units` y condicionalmente en `totem_configs`
- `SELECT` de alta frecuencia en `units` por `(unit_id, api_key, is_active)` — este query es el que valida cada reconexión MQTT. Debe ser rápido (índice en `api_key` o en `(unit_id, api_key)`)
- `UPDATE units SET is_active = false` para revocación — sin necesidad de reiniciar ningún servicio

**Nota:** el campo `api_key` en `units` actualmente es `VARCHAR UNIQUE NOT NULL`. Esto implica que hay un índice único sobre él, lo cual sirve como índice de búsqueda para la autenticación MQTT. Sin embargo, para una búsqueda por `(unit_id, api_key)` puede ser más eficiente un índice compuesto. Ver sección de discrepancias.

---

### 2.2 Ingesta de lecturas de sensores

**Actores:** ESP32 → Mosquitto → FastAPI → DB  
**Flujo:**
1. ESP32 publica `totem/{unit_id}/readings` cada 1–5 minutos (QoS 1)
2. FastAPI (suscrito al topic) recibe el payload y hace `INSERT` en `readings`
3. Los reenvíos del buffer offline pueden tener timestamps pasados — se insertan con el timestamp original del dispositivo

**Frecuencia esperada:**
- 1 lectura por unidad cada 1–5 minutos (candidato: 3 min — ver decisión pendiente)
- A 3 min: ~20 lecturas/hora por unidad, ~480 lecturas/día por unidad
- Con 10 unidades activas: ~4.800 inserts/día
- Con 100 unidades activas: ~48.000 inserts/día

**Operaciones requeridas:**
- `INSERT` en `readings` — alta frecuencia, escritura continua
- `SELECT` por `unit_id` + rango de `timestamp` — query del dashboard para histórico
- `SELECT` de la última lectura por unidad — query del dashboard para estado actual (última fila por `unit_id`)

**Consideraciones TimescaleDB:**
- `readings` debe ser una hypertable particionada por `timestamp`
- La clave primaria compuesta `(unit_id, timestamp)` garantiza que no se dupliquen lecturas — importante para el reenvío del buffer offline con timestamps pasados
- El tamaño de chunk de la hypertable debe calibrarse en función del volumen real esperado (a definir)

---

### 2.3 Registro de eventos de actuadores

**Actores:** ESP32 → Mosquitto → FastAPI → DB  
**Flujo:**
1. ESP32 publica `totem/{unit_id}/events` cada vez que enciende o apaga la bomba (o abre/cierra la válvula)
2. FastAPI inserta en `device_events` con el tipo de evento y el trigger (`autonomous` o `override`)
3. La duración de un ciclo de bomba se calcula como diferencia entre el `pump_off` y el `pump_on` inmediatamente anterior de la misma unidad

**Frecuencia esperada:**
- Variable según la especie y las condiciones ambientales
- Cota superior estimada: 1 ciclo de riego por lectura de sensores (en caso extremo, el ESP32 riega en cada ciclo) = 20 eventos/hora por unidad (2 filas: `pump_on` + `pump_off`)
- En condiciones normales la frecuencia será mucho menor

**Operaciones requeridas:**
- `INSERT` en `device_events`
- `SELECT` de la última secuencia `pump_on`/`pump_off` por unidad para calcular duración del ciclo activo
- `SELECT` del historial de eventos por unidad y rango de fechas (dashboard FR-26)
- `SELECT` cruzado de `device_events` con `readings` en el mismo intervalo de tiempo (dashboard FR-26 — correlacionar eventos de riego con valores de sensores)

---

### 2.4 Ingesta de alertas

**Actores:** ESP32 → Mosquitto → FastAPI → DB → Bot Telegram  
**Flujo:**
1. ESP32 detecta condición crítica (flotador 30% en el aire, sensor desconectado, fallo de bomba) y publica en `totem/{unit_id}/alerts`
2. FastAPI inserta en `alerts` y dispara notificación por Telegram si hay salida a internet
3. Si no hay salida a internet, la alerta queda en la DB y se muestra en el dashboard (FR-36)
4. Las notificaciones pendientes deben encolarse y enviarse al reconectar (FR-37)

**Frecuencia esperada:**
- Baja — eventos excepcionales, no flujo continuo
- No requiere particionado por tiempo ni hypertable

**Operaciones requeridas:**
- `INSERT` en `alerts`
- `SELECT` de alertas por unidad con filtros (unidad, rango de fechas, severidad) — dashboard FR-35
- Lectura de alertas no notificadas para encolado de Telegram (requiere algún mecanismo para marcar qué alertas ya se notificaron — ver discrepancias)

---

### 2.5 Envío de comandos de override

**Actores:** usuario → dashboard → FastAPI → Mosquitto → ESP32  
**Flujo:**
1. Usuario presiona "bomba ON" en el dashboard o envía comando via Telegram
2. Dashboard llama a `POST /api/v1/units/{unit_id}/commands`
3. FastAPI inserta en `commands` con `issued_by` (usuario) y publica al topic MQTT `totem/{unit_id}/commands`
4. Cuando la publicación MQTT al broker es exitosa, FastAPI actualiza `delivered_at` en el registro

**Frecuencia esperada:**
- Muy baja — acción manual puntual

**Operaciones requeridas:**
- `INSERT` en `commands`
- `UPDATE commands SET delivered_at` cuando el broker confirma la publicación
- `SELECT` del historial de comandos por unidad (auditoría)

**Nota importante:** el modelo actual es fire-and-forget — `delivered_at` registra que el mensaje llegó al broker, no que el ESP32 lo ejecutó. Si el ESP32 ejecuta el comando y algo falla (ej. bomba no responde), no hay mecanismo actual para reportarlo de vuelta a la DB. Esto está marcado como decisión pendiente en `ecosistema/overview.md`.

---

### 2.6 Gestión de perfiles de cultivo

**Actores:** admin → dashboard → FastAPI → DB → Mosquitto → ESP32  
**Flujo de creación/edición:**
1. Admin crea o edita un perfil (`POST /api/v1/profiles` o `PUT /api/v1/profiles/{profile_id}`)
2. FastAPI hace `INSERT` o `UPDATE` en `crop_profiles`

**Flujo de asignación:**
1. Admin asigna un perfil a una unidad (`PUT /api/v1/units/{unit_id}/profile`)
2. FastAPI actualiza `totem_configs.active_profile_id` con el UUID del perfil seleccionado
3. FastAPI publica el perfil completo (JSON) al topic MQTT `totem/{unit_id}/profile`
4. El ESP32 recibe el perfil, lo cachea en flash y empieza a usarlo en el siguiente ciclo

**Operaciones requeridas:**
- `INSERT` / `UPDATE` en `crop_profiles`
- `UPDATE totem_configs SET active_profile_id` — cuando se asigna un perfil a una unidad
- `SELECT crop_profiles JOIN totem_configs` — para construir el payload MQTT del perfil activo
- `SELECT crop_profiles WHERE organization_id = ?` — listado de perfiles disponibles para un usuario
- Los perfiles son privados por organización — toda consulta de perfiles debe estar acotada por `organization_id`

---

### 2.7 OTA — gestión de firmware

**Actores:** admin (deploy) → FastAPI → Mosquitto → ESP32  
**Flujo:**
1. Admin sube un nuevo binario de firmware al server
2. FastAPI notifica al ESP32 via MQTT (`totem/{unit_id}/ota`) con versión, URL de descarga y hash SHA-256
3. ESP32 descarga el binario via `GET /api/v1/firmware/{version}/binary`
4. ESP32 verifica el hash, aplica la actualización, se reinicia y reporta la nueva versión instalada

**Operaciones requeridas:**
- Almacenamiento de binarios y metadatos de versiones de firmware — **no existe tabla para esto en el schema actual** (ver discrepancias)
- `UPDATE units SET firmware_version` — cuando el ESP32 reporta la versión instalada tras reinicio exitoso
- `SELECT units WHERE firmware_version != <latest>` — para saber qué unidades tienen firmware desactualizado

---

### 2.8 Autenticación de usuarios

**Actores:** usuario → dashboard → FastAPI → DB  
**Flujo:**
1. Usuario hace `POST /api/v1/auth/login` con email y password
2. FastAPI busca el usuario en `users` por email, verifica el hash de contraseña
3. Si es válido, genera JWT (expiración ~1h) y refresh token de larga duración
4. En cada request del dashboard, FastAPI valida el JWT y comprueba que el usuario tiene acceso a la organización/unidad solicitada

**Operaciones requeridas:**
- `SELECT users WHERE email = ?` — login
- `SELECT memberships WHERE user_id = ? AND organization_id = ?` — control de acceso por organización
- Los refresh tokens no tienen tabla en el schema actual — ver discrepancias

---

## 3. Volumen esperado de datos

| Tabla | Frecuencia de escritura | Estimado diario (10 unidades) | Estimado diario (100 unidades) |
|---|---|---|---|
| `readings` | 1 fila por unidad cada 3 min | ~4.800 filas | ~48.000 filas |
| `device_events` | Baja (variable) | ~200–400 filas | ~2.000–4.000 filas |
| `alerts` | Muy baja (excepcional) | ~5–20 filas | ~50–200 filas |
| `commands` | Muy baja (manual) | ~10–50 filas | ~100–500 filas |
| `crop_profiles` | Muy baja (configura una vez) | No relevante | No relevante |
| `units`, `users`, `memberships` | Muy baja (alta inicial) | No relevante | No relevante |

**Conclusión de volumen:** el flujo de escritura es dominado casi completamente por `readings`. El resto de tablas son de bajo volumen. La optimización de `readings` como hypertable TimescaleDB es la decisión más importante de rendimiento.

**Retención:** FR-14 especifica retención indefinida — no hay política de expiración de datos en el MVP. TimescaleDB permite definir políticas de compresión y downsampling para datos históricos antiguos si el tamaño se convierte en un problema (feature diferida).

---

## 4. Consultas más comunes

### 4.1 Estado actual de una unidad (dashboard — polling cada 30-60s)

```
GET /api/v1/units/{unit_id}
```

Requiere, en una sola respuesta:
- La fila más reciente de `readings` para esa unidad
- El último evento de `device_events` para saber si la bomba está ON u OFF ahora mismo
- El modo actual: ¿hay un comando `pause_autonomous` activo sin expirar?
- El nivel de tanque: implícito en la última alerta `tank_low` no resuelta

Este endpoint agrega datos de al menos tres tablas. Puede resolverse con queries individuales o con una vista materializada. Es el endpoint de mayor frecuencia de consulta.

### 4.2 Histórico de lecturas de sensores

```
GET /api/v1/units/{unit_id}/readings?from=...&to=...
```

Consulta más pesada — puede retornar miles de filas si el rango es amplio. Requiere:
- `SELECT * FROM readings WHERE unit_id = ? AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`
- Índice en `(unit_id, timestamp)` — ya cubierto por la clave primaria compuesta de la hypertable

El dashboard muestra gráficas de T y RH en histórico (FR-27). Li y CO₂ solo en estado actual (MVP). Paginación pendiente de definir (ver pendientes en `api-contract.md`).

### 4.3 Historial de eventos de riego

```
GET /api/v1/units/{unit_id}/events?from=...&to=...
```

- `SELECT * FROM device_events WHERE unit_id = ? AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`
- Para el dashboard (FR-26): cruzar con lecturas del mismo rango para mostrar contexto de sensores al momento del riego

### 4.4 Validación de credenciales MQTT (alta frecuencia en reconexiones)

```
POST /api/internal/mqtt/auth
```

- `SELECT id FROM units WHERE unit_id = ? AND api_key = ? AND is_active = true`
- Este query se ejecuta en cada reconexión de cada ESP32. Debe tener latencia < 100ms. El índice único sobre `api_key` lo cubre, pero un índice compuesto sobre `(unit_id, api_key)` puede ser más óptimo.

### 4.5 Listado de unidades de un usuario

```
GET /api/v1/units
```

- `SELECT units.* FROM units JOIN memberships ON units.organization_id = memberships.organization_id WHERE memberships.user_id = ?`
- Incluye estado actual de cada unidad (última lectura, estado de bomba)

### 4.6 Alertas no notificadas (encolado Telegram)

- Requiere identificar alertas que aún no se enviaron por Telegram
- El schema actual no tiene campo para rastrear el estado de notificación (ver discrepancias)

---

## 5. Discrepancias y observaciones

> Las discrepancias a continuación son observaciones del análisis — NO se deben hacer cambios al schema sin consultar primero con el equipo.

### D-01: No existe tabla de versiones de firmware

El flujo OTA (FR-10, FR-20) requiere que el server almacene binarios y metadatos de versiones (versión, URL de descarga, hash SHA-256, fecha de publicación). El schema actual no tiene ninguna tabla para esto.

**Impacto:** el endpoint `GET /api/v1/firmware/{version}/binary` y la lógica de notificación OTA no tienen respaldo en DB.

**Opciones a evaluar:**
- Tabla `firmware_releases` con: `version VARCHAR PK`, `binary_path VARCHAR`, `sha256 VARCHAR`, `released_at TIMESTAMPTZ`, `is_current BOOLEAN`
- Almacenamiento del binario en filesystem del servidor con solo metadatos en DB (más simple para MVP)

---

### D-02: No existe tabla ni campo para refresh tokens

El contrato de API describe JWT de corta duración + refresh token de larga duración. El schema actual no tiene tabla para almacenar refresh tokens (necesaria para invalidación, rotación y revocación).

**Impacto:** sin tabla de refresh tokens, el sistema no puede invalidar sesiones activas (ej. cuando un usuario cambia su contraseña o se le revoca acceso).

**Opciones a evaluar:**
- Tabla `refresh_tokens`: `token_hash VARCHAR PK`, `user_id UUID FK → users`, `expires_at TIMESTAMPTZ`, `revoked_at TIMESTAMPTZ`
- Refresh tokens stateless (sin tabla) con tiempo de vida corto — simplifica pero reduce capacidad de revocación

---

### D-03: Las alertas no tienen campo de estado de notificación Telegram

FR-36 y FR-37 especifican que las alertas no enviadas por Telegram deben encolarse y enviarse al reconectar. El schema actual de `alerts` no tiene campo para rastrear si la notificación fue enviada y cuándo.

**Impacto:** no hay forma de saber en la DB qué alertas ya se notificaron y cuáles están pendientes.

**Opciones a evaluar:**
- Agregar `telegram_sent_at TIMESTAMPTZ` (nullable) a `alerts` — `NULL` = pendiente, timestamp = entregado
- Tabla separada de cola de notificaciones

---

### D-04: La tabla `alerts` no tiene campo de resolución

El esquema actual solo registra cuándo ocurrió la alerta pero no si fue resuelta. El dashboard (FR-35) podría necesitar mostrar alertas "activas" vs. "resueltas". Un `tank_low` sigue siendo relevante hasta que el tanque se llene.

**Impacto:** sin estado de resolución, el dashboard no puede distinguir una alerta activa de una histórica.

**Opciones a evaluar:**
- Agregar `resolved_at TIMESTAMPTZ` (nullable) a `alerts`
- Resolución implícita (la última alerta del mismo tipo para la misma unidad está "activa"; las anteriores están "resueltas") — más simple pero menos explícito

---

### D-05: Estado actual del modo autónomo vs. override no tiene representación en DB

FR-23 y FR-30 requieren que el dashboard muestre si el sistema está en modo autónomo o en override manual. El schema tiene la tabla `commands` con tipo `pause_autonomous`, pero no hay campo en `units` ni en `totem_configs` que registre el estado actual del modo.

**Impacto:** para saber si una unidad está en override, habría que buscar el último comando `pause_autonomous` y verificar si su ventana de tiempo todavía está activa — lo que implica que `commands.payload` debe incluir la duración del pause, y que el cálculo del estado actual es derivado, no almacenado.

**Observación:** esto puede ser correcto por diseño (estado derivado, no redundante), pero requiere que el payload del comando `pause_autonomous` incluya una duración y que el backend calcule si el período expiró. El esquema actual de `commands.payload JSONB` lo soporta por ser libre, pero no está documentado.

---

### D-06: No hay índice explícito documentado para la autenticación MQTT

El campo `api_key` tiene `UNIQUE NOT NULL`, lo que implica un índice único. Para la query de autenticación MQTT (`WHERE unit_id = ? AND api_key = ? AND is_active = true`), un índice sobre solo `api_key` es suficiente si la selectividad es alta (cada `api_key` es única). Sin embargo, el nombre del índice y su forma exacta no están documentados en el schema.

**Observación:** no es una discrepancia crítica, pero conviene documentarlo explícitamente cuando se generen los CREATE TABLE.

---

### D-07: El Tanque de Suministro publica alertas pero no lecturas de sensores de calidad de agua

El documento `capa1/tanque-de-suministro/sistema-conectividad/sistema-conectividad.md` menciona como pendiente si los sensores de calidad de agua (pH, EC, temperatura) van en el MVP del tanque de suministro. Si se incluyen, necesitarían columnas en `readings` o una tabla separada.

**Impacto potencial:** si pH, EC y temperatura del tanque se agregan a `readings`, la tabla ancha crece. Actualmente `readings` solo tiene columnas para el Totem Principal (T, RH, Li, CO₂). Las columnas del tanque serían siempre `NULL` para unidades tipo `totem` y viceversa.

**Opciones a evaluar:**
- Columnas adicionales en `readings` (`ph`, `ec`, `water_temp`) — nullable, consistente con el diseño actual
- Tabla `tank_readings` separada — más limpio pero más joins
- La decisión depende de si esta feature entra en el MVP (actualmente no está)

---

### D-08: No hay tabla `supply_tank_configs`

Existe `totem_configs` para configuración específica de unidades tipo `totem`. No existe una tabla equivalente `supply_tank_configs` para unidades tipo `supply_tank`. Actualmente el tanque de suministro no tiene parámetros de configuración específicos en el schema, lo que puede ser correcto para el MVP dado que su rol es simple (solo genera alertas).

**Observación:** si en el futuro el tanque de suministro requiere configuración (ej. umbrales de alerta propios, parámetros de sensores de calidad de agua), se necesitará una tabla de configuración similar a `totem_configs`.

---

### D-09: El campo `units.type` no está validado a nivel de DB

El campo `type` en `units` es `VARCHAR NOT NULL` con valores documentados `totem` y `supply_tank`. No hay constraint de CHECK ni enum en el schema documentado. Un valor inválido sería aceptado por la DB sin error.

**Sugerencia:** agregar `CHECK (type IN ('totem', 'supply_tank'))` o convertirlo a un tipo ENUM de PostgreSQL.

---

### D-10: El campo `commands.type` tampoco está validado a nivel de DB

Mismo patrón que D-09. Los tipos de comando (`pump_on`, `pump_off`, `pause_autonomous`, `update_profile`, `valve_open`, `valve_close`) están documentados pero no hay CHECK constraint.

---

## 6. Decisiones pendientes que afectan la DB

> Las marcadas con [DOCUMENTADA] ya aparecen en la documentación del proyecto. Las marcadas con [DERIVADA] son consecuencia del análisis de este documento.

### P-01 [DOCUMENTADA] — Intervalo del ciclo de decisión y publicación MQTT

El volumen de la tabla `readings` depende directamente de este valor. Candidato: 3 minutos. Con 5 minutos se reduce el volumen en un 40%. Con 1 minuto se multiplica por 3.

**Impacto en DB:** sizing del storage, política de compresión de TimescaleDB, tamaño de chunk de la hypertable.

---

### P-02 [DOCUMENTADA] — Política del buffer offline

El reenvío del buffer puede generar un pico de inserts en `readings` y `device_events` cuando el ESP32 reconecta tras un período offline. El schema lo soporta (la clave primaria de `readings` previene duplicados), pero el volumen máximo del burst depende del tamaño del buffer.

**Impacto en DB:** el `INSERT` de lecturas con timestamp pasado debe funcionar correctamente — la PK compuesta `(unit_id, timestamp)` lo garantiza para lecturas, pero si dos lecturas del buffer tienen el mismo timestamp (poco probable pero posible), se rechazaría el segundo insert. Se recomienda manejar esto con `ON CONFLICT DO NOTHING` en la capa de aplicación.

---

### P-03 [DOCUMENTADA] — Formato exacto de payloads MQTT

Los payloads MQTT de cada topic (estructura JSON, campos, tipos) no están definidos. Esto afecta qué campos llegan a la DB y cómo se mapean a las columnas.

**Impacto en DB:** hasta que los payloads estén cerrados, no se puede validar que el schema de `readings`, `device_events` y `alerts` cubre todos los campos necesarios.

---

### P-04 [DOCUMENTADA] — Timestamps: ISO 8601 UTC en todos los payloads

Pendiente de confirmar. Si los timestamps llegan en zona horaria local del dispositivo o en Unix epoch, el server debe normalizarlos antes de insertar en `readings.timestamp (TIMESTAMPTZ)`.

**Impacto en DB:** recomendación de que todo timestamp se almacene como TIMESTAMPTZ en UTC. PostgreSQL convierte automáticamente si el string tiene info de zona horaria.

---

### P-05 [DOCUMENTADA] — Confirmación de ejecución de comandos

Si el ESP32 reporta el resultado de ejecución de un comando (ej. `pump_on` falló porque la bomba no responde), ese resultado necesita almacenarse en algún lugar. El schema actual no tiene campo para esto.

**Impacto en DB:** potencialmente agregar `executed_at TIMESTAMPTZ` y `execution_result VARCHAR` a `commands`, o una tabla separada de eventos de resultado de comandos.

---

### P-06 [DOCUMENTADA] — Configuración de sesiones MQTT (clean vs. persistent session)

Con sesiones persistentes, el broker encola mensajes mientras el dispositivo está desconectado. Con clean session, se pierden. Esta decisión afecta la durabilidad de los comandos, perfiles y notificaciones OTA — no afecta directamente el schema de la DB.

---

### P-07 [DOCUMENTADA] — Retained messages en topics de perfil y comandos

Si el topic `totem/{unit_id}/profile` usa `retain=true`, el ESP32 recibirá el último perfil publicado al reconectar, sin necesidad de que el server lo republique. Esto no afecta el schema de DB pero sí el comportamiento esperado del flujo de asignación de perfil.

---

### P-08 [DERIVADA] — Estrategia de paginación para lecturas históricas

El endpoint `GET /api/v1/units/{unit_id}/readings` puede retornar miles de filas. La estrategia de paginación (cursor vs. offset) afecta cómo se construyen las queries y si se necesitan índices adicionales.

**Recomendación:** cursor-based paging usando `timestamp` como cursor es más eficiente con hypertables TimescaleDB que offset/limit, especialmente para datasets grandes.

---

### P-09 [DERIVADA] — Tamaño de chunk de la hypertable `readings`

TimescaleDB partición automáticamente la hypertable por tiempo. El tamaño del chunk (por defecto 7 días) debe ajustarse según la frecuencia de escritura y el patrón de acceso. Chunks muy grandes degradan las queries de rango; chunks muy pequeños degradan los inserts.

**Recomendación a evaluar con el DBA:** para el volumen esperado (10–100 unidades, lecturas cada 3 min), un chunk de 7 días es probablemente adecuado. Revisar con datos reales después del primer mes de operación.

---

### P-10 [DERIVADA] — Política de compresión y downsampling para datos históricos

FR-14 especifica retención indefinida. Con lecturas cada 3 min, en 1 año y 100 unidades la tabla `readings` tendrá ~17.5 millones de filas. TimescaleDB soporta compresión nativa (columnar) y continuous aggregates (downsampling automático). No es urgente para el MVP, pero conviene definirlo antes de que el volumen se convierta en un problema.

---

## 7. Preguntas para el equipo

### Q-01: ¿Se almacenan los refresh tokens en DB o son stateless?

La documentación describe JWT + refresh token pero no hay tabla en el schema. ¿El refresh token se almacena en DB (permite revocación individual) o es stateless con tiempo de vida propio? Si es stateless, ¿cuál es su tiempo de expiración?

---

### Q-02: ¿Cómo se aloja el binario de firmware para OTA?

El endpoint `GET /api/v1/firmware/{version}/binary` existe en el contrato de API pero no hay tabla ni estructura definida para almacenar binarios y sus metadatos. ¿El binario va en el filesystem del servidor con metadatos en una tabla nueva? ¿O se aloja en un bucket externo (S3, etc.)? El server debe ser deployment-agnostic, lo que hace que un bucket externo complique el setup en RPi.

---

### Q-03: ¿Las alertas tienen estado de resolución?

¿Una alerta `tank_low` se "cierra" automáticamente cuando el tanque vuelve al rango normal, o permanece como registro histórico sin estado de cierre? Si el dashboard va a mostrar alertas "activas" vs. "pasadas" (FR-35), necesitamos un campo `resolved_at` o lógica equivalente.

---

### Q-04: ¿Cómo se rastrea el envío de notificaciones Telegram?

FR-37 dice que las notificaciones no enviadas deben encolarse y enviarse al reconectar. ¿Esto se implementa como una cola en memoria (no persiste reinicio del server) o se almacena en DB? Si es en DB, ¿campo en `alerts` o tabla separada?

---

### Q-05: ¿El comando `pause_autonomous` tiene duración en el payload?

FR-29 permite pausar el modo autónomo por un tiempo definido (ej. "pausar 1 hora"). ¿La duración va en `commands.payload` (JSONB libre)? Si es así, ¿hay un campo de expiración calculado que se almacene? ¿O el ESP32 gestiona localmente el retorno al modo autónomo y solo notifica al server?

---

### Q-06: ¿El Tanque de Suministro tendrá sensores de calidad de agua en el MVP?

El documento `capa1/tanque-de-suministro/sistema-conectividad/sistema-conectividad.md` marca como pendiente si pH, EC y temperatura del tanque van en el MVP. Si entran, necesitan columnas en `readings` o tabla separada. ¿Está decidido?

---

### Q-07: ¿Los tipos de `units.type` y `commands.type` se validan en la DB?

Actualmente son `VARCHAR` sin CHECK constraint. ¿Se añaden CHECK constraints o enum types de PostgreSQL, o la validación se deja completamente en la capa de aplicación (Pydantic)?

---

### Q-08: ¿Puede un perfil de cultivo asignarse a múltiples unidades simultáneamente?

La relación actual es: `totem_configs.active_profile_id → crop_profiles`. Un perfil puede estar asignado a varias unidades a la vez (muchos `totem_configs` pueden apuntar al mismo `crop_profile`). ¿Es esto intencional? Si un perfil se edita mientras está asignado a unidades activas, ¿el server republica automáticamente el perfil actualizado a todas esas unidades via MQTT?

---

### Q-09: ¿Los perfiles de cultivo son inmutables una vez asignados?

Relacionado con Q-08: si se edita un perfil que ya está en uso, ¿los datos históricos de decisiones de riego quedan sin contexto (no saben qué versión del perfil estaba vigente)? ¿Se requiere versionado de perfiles para trazabilidad histórica, o no es una preocupación del MVP?

---

### Q-10: ¿Hay requerimiento de multi-tenancy estricto a nivel de DB (Row Level Security)?

El sistema tiene organizations → units → datos. El control de acceso actual se gestiona en la capa de aplicación (FastAPI filtra por `organization_id` del usuario autenticado). ¿Se requiere Row Level Security (RLS) de PostgreSQL como capa adicional, o la validación en aplicación es suficiente para el MVP?

---

*Documento generado a partir de la documentación en `docs/`. La fuente de verdad del schema es `docs/capa2/schema.md`. Este documento no propone cambios al schema — solo identifica requerimientos, observaciones y preguntas para que el experto en base de datos los evalúe.*
