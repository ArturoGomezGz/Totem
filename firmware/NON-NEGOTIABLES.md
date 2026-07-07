# Componentes no negociables para cualquier firmware Totem

Este documento aplica a **cualquier** proyecto nuevo dentro de `firmware/` que vaya a
correr en una unidad real y hablar con el server (`firmware/bootstrap`, `firmware/simulator`,
`firmware/genesis`, y cualquier futuro reemplazo). Si un proyecto nuevo omite alguno de estos
puntos, deja de ser compatible con el ciclo de vida OTA, con el panel de administración de
firmware, o con el broker MQTT — no son detalles de estilo, son el contrato con el server.

Referencia de implementación real: `firmware/simulator/main/simulator.c` (firmware con
funcionalidad probada en hardware) y `firmware/bootstrap/main/bootstrap.c` (mínimo, sin
sensores). Todo firmware nuevo parte de duplicar ese esqueleto — no de un componente
compartido (ver nota al final).

---

## 1. Identidad y versión del binario

- **`version.txt`** en la raíz del proyecto (`firmware/<proyecto>/version.txt`), con un
  semver plano (`1.1.0`, sin prefijo `v`). Es la única fuente de verdad de versión.
- **`CMakeLists.txt`** del proyecto debe forzar esa fuente antes de `include(project.cmake)`:

  ```cmake
  set(PROJECT_VER_FILE "${CMAKE_CURRENT_LIST_DIR}/version.txt")
  ```

  Sin esto, ESP-IDF usa `git describe` porque el proyecto vive dentro del repo Totem, y la
  versión reportada sale como `d528eab-dirty` en vez del semver real.
- El firmware **nunca** hardcodea la versión en el código — se lee siempre así:

  ```c
  static const char *firmware_version(void) {
      return esp_ota_get_app_description()->version;
  }
  ```

- El server (`server/routers/firmware.py::_extract_firmware_version`) lee la versión
  directamente de los bytes del `.bin` subido (offset fijo del descriptor de aplicación de
  ESP-IDF). Si el binario no tiene ese descriptor (no compilado con ESP-IDF) o la versión
  viene vacía, el upload se rechaza con 400. Esto significa que **subir un binario con la
  versión "correcta a mano" es imposible** — solo compilar con el `version.txt` correcto.

## 2. Tabla de particiones — debe ser IDÉNTICA en todo el fleet

```
# Name,    Type, SubType,  Offset,    Size
nvs,       data, nvs,      0x9000,    0x5000
otadata,   data, ota,      0xe000,    0x2000
ota_0,     app,  ota_0,    0x10000,   0x1C0000
ota_1,     app,  ota_1,    0x1D0000,  0x1C0000
spiffs,    data, spiffs,   0x390000,  0x70000
```

**Por qué no es negociable:** la tabla de particiones se flashea una sola vez por USB (con
`bootstrap`, normalmente) y un OTA posterior **nunca la vuelve a escribir** — el OTA solo
escribe dentro de `ota_0`/`ota_1`, los slots que ya existen en el flash. Si el `partitions.csv`
de un proyecto nuevo (ej. `genesis`) no coincide byte a byte con el de `bootstrap`, cualquier
unidad que arrancó con `bootstrap` y reciba un OTA hacia ese proyecto queda con particiones
inconsistentes. Copiar este archivo tal cual, sin editar offsets ni tamaños.

Consecuencia práctica: el binario `app` (`.bin` compilado) debe caber en `0x1C0000` (1.75 MB).
Si un firmware nuevo con más dependencias (ej. TFLite Micro) se acerca a ese límite, hay que
resolverlo por otra vía (menos particiones spiffs, etc.) — nunca cambiando el tamaño de
`ota_0`/`ota_1` sin coordinarlo en los tres proyectos a la vez.

## 3. `sdkconfig.defaults` — tres flags obligatorias

```
CONFIG_PARTITION_TABLE_CUSTOM=y
CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"

CONFIG_ESPTOOLPY_FLASHSIZE_4MB=y
CONFIG_ESPTOOLPY_FLASHSIZE="4MB"

CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y
```

- Las dos primeras activan la tabla de particiones custom de arriba (el default de ESP-IDF es
  2MB, insuficiente para nvs+otadata+ota_0+ota_1+spiffs).
- `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE` habilita el rollback automático del bootloader — sin
  esto, el mecanismo de la sección 5 no tiene efecto (el bootloader ni siquiera espera
  confirmación).

`sdkconfig.defaults` y `sdkconfig` están en `.gitignore` en ambos proyectos existentes porque
`sdkconfig.defaults` en desarrollo también carga credenciales WiFi de conveniencia
(`CONFIG_WIFI_SSID`, etc. — no usadas por el código, que lee todo de NVS, pero quedan ahí como
plantilla histórica). Todo proyecto nuevo debe traer un `sdkconfig.defaults.example` committeado
con placeholders, igual que los dos existentes.

## 4. Provisioning — credenciales solo en NVS, nunca compiladas

Namespace `config`, exactamente estas cinco claves, leídas en modo `NVS_READONLY` al arrancar:

| Clave | Uso |
|---|---|
| `wifi_ssid` | SSID de la red WiFi |
| `wifi_pass` | Password WiFi |
| `mqtt_uri` | URI del broker, ej. `mqtt://10.120.154.220:1883` |
| `unit_id` | UUID de la unidad — debe existir en la tabla `units` del server |
| `api_key` | Credencial MQTT — el server la valida vía `mosquitto-go-auth` |

Si `nvs_open` falla o falta una clave, el firmware debe loguear el error y hacer
`esp_restart()` — no debe intentar arrancar con defaults ni credenciales embebidas. Esto es lo
que hace posible que **el mismo `.bin` se flashee a cualquier unidad** — la identidad vive
exclusivamente en NVS, nunca en el binario. Ver `firmware/simulator/PROVISIONING.md` para el
flujo completo (genera `nvs_config.csv` desde `nvs_config.csv.example`, convierte a `nvs.bin`
con `nvs_partition_gen.py`, flashea con `esptool.py write_flash 0x9000`).

## 5. OTA — implementación exacta requerida

Topic de suscripción obligatorio: **`totem/{unit_id}/ota`**. El payload que publica el server
(`server/routers/firmware.py::deploy_firmware`) es:

```json
{"firmware_release_id": "...", "version": "1.1.0", "url": "https://.../binary", "sha256": "..."}
```

El handler debe, en este orden exacto:

1. Ignorar el mensaje si ya hay un OTA en curso (`ota_in_progress`) — nunca dos a la vez.
2. Parsear JSON; si falta `url`, `sha256` o `version`, descartar sin crashear.
3. Lanzar una task dedicada (`xTaskCreate`, stack ≥ 8192) que:
   - Toma la partición con `esp_ota_get_next_update_partition(NULL)`.
   - Abre con `esp_ota_begin(..., OTA_WITH_SEQUENTIAL_WRITES, ...)`.
   - Descarga por HTTP (`esp_http_client`) en streaming, actualizando un hash SHA-256
     (`mbedtls_md`) incrementalmente mientras escribe cada chunk con `esp_ota_write`.
   - Al terminar, compara el hash calculado contra el `sha256` del mensaje **antes** de
     `esp_ota_end` — si no coincide, aborta con `esp_ota_abort` y no continúa.
   - Si coincide: `esp_ota_end` → `esp_ota_set_boot_partition` → delay de 2s → `esp_restart()`.
   - Cualquier fallo en el camino: loguear, liberar el buffer/handle, dejar
     `ota_in_progress = false`, el dispositivo sigue en la versión actual (nunca reinicia hacia
     un binario no verificado).

No hay negociación posible en la verificación SHA-256 — es la única garantía de integridad
entre lo que el server sirvió y lo que quedó escrito en flash.

## 6. Rollback automático — confirmación obligatoria al conectar

Al arrancar (`app_main`), antes de inicializar WiFi:

```c
const esp_partition_t *running = esp_ota_get_running_partition();
esp_ota_img_states_t ota_state;
if (esp_ota_get_state_partition(running, &ota_state) == ESP_OK
    && ota_state == ESP_OTA_IMG_PENDING_VERIFY) {
    pending_rollback_confirm = true;
    xTaskCreate(rollback_watchdog_task, "rollback_wd", 2048, NULL, 5, NULL);
}
```

`rollback_watchdog_task` espera `ROLLBACK_CONFIRM_TIMEOUT_MS` (90000 ms) y, si
`pending_rollback_confirm` sigue en `true`, fuerza `esp_restart()` — al no estar la imagen
marcada como válida, el bootloader revierte solo a la partición anterior conocida como buena.

La confirmación ocurre en `MQTT_EVENT_CONNECTED`, después de suscribirse a los topics y publicar
el status:

```c
if (pending_rollback_confirm) {
    esp_ota_mark_app_valid_cancel_rollback();
    pending_rollback_confirm = false;
}
```

**Por qué exactamente ahí:** llegar a `MQTT_EVENT_CONNECTED` prueba que WiFi + credenciales MQTT
del firmware nuevo funcionan de punta a punta. Confirmar antes (ej. justo después de arrancar)
anularía la protección — un firmware que arranca pero no logra conectar nunca se revertiría.

Este es el mecanismo que ya se probó en hardware real (ver commit `db6d909`): un OTA a una
versión que no logra conectar hace rollback automático a la última buena.

## 7. Reporte de versión — topic y formato exactos

Topic: **`totem/{unit_id}/status`**, payload `{"firmware_version": "<version>"}`, publicado con
`retain=1`:

```c
esp_mqtt_client_publish(mqtt_client, topic_status, payload, 0, 1, 1);
```

`retain=1` es obligatorio — el server debe poder leer la última versión reportada por una
unidad que está offline en el momento de la consulta (se resuscribe y recibe el retained message
apenas el dispositivo vuelve a conectar). Se publica una vez, inmediatamente después de
suscribirse a los topics en `MQTT_EVENT_CONNECTED` — no hace falta repetirlo periódicamente.

El dashboard compara este valor contra `target_firmware_release_id` de la unidad para mostrar
"al día" vs. "actualización pendiente" — si el topic o el formato del payload cambian, ese
indicador se rompe silenciosamente (no hay validación de esquema del lado del server sobre este
payload).

## 8. Topics MQTT — convención de nombres

Todos bajo el prefijo `totem/{unit_id}/`:

| Topic | Dirección | Obligatorio | Uso |
|---|---|---|---|
| `ota` | suscribe | **Sí** | Notificación de nuevo release (sección 5) |
| `status` | publica (retain) | **Sí** | Versión de firmware activa (sección 7) |
| `commands` | suscribe | Si el firmware tiene actuadores | Comandos manuales (`pump_on`, `pump_off`, etc.) |
| `readings` | publica | Si el firmware tiene sensores | Lecturas periódicas |
| `alerts` | publica | Si aplica lógica de alerta | Eventos que disparan notificación (Telegram) |
| `events` | publica | Si hay comandos | Confirmación de que un comando se ejecutó |
| `profile` | suscribe | Opcional | Perfil de cultivo activo cacheado |

`unit_id` y `api_key` (usados como `client_id`/`username`/`password` MQTT) deben coincidir con un
registro existente en la tabla `units` — el broker (`mosquitto-go-auth` contra el endpoint
interno del server) rechaza la conexión si no coinciden.

## 9. Qué NO es negociable vs. qué sí varía por proyecto

No negociable (todo lo de arriba): NVS, particiones, sdkconfig, versión vía `version.txt`, OTA,
rollback, topic `status`/`ota`.

Sí varía libremente entre proyectos: qué sensores/actuadores existen, el contenido de
`readings`/`alerts`/`commands`, el intervalo de publicación, y cualquier lógica de decisión de
riego o modelo de estimación (ver decisiones pendientes de ML en `docs/ecosistema/overview.md`).

## 10. Nota sobre duplicación de código

El código de WiFi/NVS/OTA está intencionalmente duplicado entre `bootstrap.c`, `simulator.c`, y
cualquier proyecto nuevo — no extraído a un componente compartido (`firmware/components/...`)
porque no había toolchain de ESP-IDF disponible para validar esa extracción en el momento en que
se escribió `bootstrap`. Si en algún punto se agrega CI con el toolchain, migrar todos los
proyectos a un componente común (ej. `totem_core`) es deseable — mientras tanto, cualquier cambio
a esta lógica (ej. un fix de OTA) debe replicarse a mano en cada proyecto.
