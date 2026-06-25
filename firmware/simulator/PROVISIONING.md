# Provisioning del simulador — NVS

Provisionar significa escribir las credenciales del dispositivo (WiFi, MQTT, identidad) en una partición separada del flash del ESP32 llamada **NVS**. El firmware las lee al arrancar — ninguna credencial está compilada en el binario.

Esto replica exactamente el flujo de producción: el mismo `.bin` se flashea a cualquier ESP32, y cada uno tiene sus propias credenciales en NVS.

---

## Requisitos previos

- ESP-IDF instalado y configurado (variable `IDF_PATH` disponible)
- ESP32-C6 conectado por USB
- Python disponible en la terminal (viene con ESP-IDF)
- Saber en qué puerto está el dispositivo (`COM3`, `COM4`, etc. — lo muestra el Administrador de dispositivos en Windows)

---

## Paso 1 — Copiar la plantilla de credenciales

```bash
cp firmware/simulator/nvs_config.csv.example firmware/simulator/nvs_config.csv
```

`nvs_config.csv` está en `.gitignore` — nunca se sube al repositorio.

---

## Paso 2 — Editar las credenciales

Abre `firmware/simulator/nvs_config.csv` y ajusta los valores de la segunda columna:

```
key,type,encoding,value
config,namespace,,
wifi_ssid,data,string,IoT
wifi_pass,data,string,Plata54321
mqtt_uri,data,string,mqtt://10.120.154.220:1883
unit_id,data,string,00000000-0000-0000-0000-000000000100
api_key,data,string,sim-001-api-key-dev-only-replace-in-production
```

**Qué cambiar:**
- `wifi_ssid` — nombre de tu red WiFi
- `wifi_pass` — contraseña de tu red WiFi
- `mqtt_uri` — IP de tu PC en la red local donde corre Mosquitto (el `idf.py monitor` del ESP32 anterior te la mostró como "IP obtenida")
- `unit_id` y `api_key` — deben coincidir exactamente con un registro en la base de datos

> **Para desarrollo:** los valores de `unit_id` y `api_key` ya están en el seed de la DB (`deploy/db/schema.sql`). Sim-001 usa los valores del ejemplo arriba. Sim-002 usa `00000000-0000-0000-0000-000000000101` y `sim-002-api-key-dev-only-replace-in-production`.

---

## Paso 3 — Generar el binario NVS

Este comando convierte el CSV en un archivo binario listo para flashear:

**En PowerShell / CMD (Windows):**
```powershell
python "$env:IDF_PATH/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py" generate firmware/simulator/nvs_config.csv nvs.bin 0x5000
```

**En Bash / Git Bash:**
```bash
python $IDF_PATH/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py \
    generate firmware/simulator/nvs_config.csv nvs.bin 0x5000
```

Si funcionó correctamente aparece el archivo `nvs.bin` en tu directorio actual. No hay output de éxito — solo ves errores si algo falla.

> `0x5000` es el tamaño de la partición NVS definido en `firmware/simulator/partitions.csv`. No cambiar.

---

## Paso 4 — Flashear solo la partición NVS

La dirección `0x9000` es donde vive la partición NVS en el ESP32 (definida en `partitions.csv`). Este comando escribe **solo** esa partición — el firmware que ya está en el ESP32 no se toca.

```bash
idf.py -C firmware/simulator -p COM4 write-flash 0x9000 nvs.bin
```

Reemplaza `COM4` con el puerto de tu dispositivo.

Verás algo como:
```
Writing at 0x00009000... (100 %)
Wrote 20480 bytes (1234 compressed) at 0x00009000
Hash of data verified.
```

---

## Paso 5 — Compilar y flashear el firmware

```bash
idf.py -C firmware/simulator -p COM4 build flash monitor
```

Este comando hace tres cosas en secuencia:
1. `build` — compila el código
2. `flash` — escribe el firmware en el ESP32
3. `monitor` — abre la consola serial para ver los logs

---

## Paso 6 — Verificar que funciona

En los logs deberías ver esta secuencia:

```
I (xxx) simulator: Config cargada — unit_id: 00000000-0000-0000-0000-000000000100, broker: mqtt://...
I (xxx) simulator: IP obtenida: 10.120.154.x
I (xxx) simulator: WiFi conectado
I (xxx) simulator: MQTT conectado
I (xxx) simulator: Suscrito a: totem/00000000-.../commands
I (xxx) simulator: Lectura publicada (msg_id=1): {"temperature":22.3,"humidity":65.1,"light":301.0}
```

Para confirmar que los mensajes llegan al broker, en otra terminal:
```bash
docker exec -it totem-mosquitto mosquitto_sub -t "totem/#" -u server -P changeme -v
```

---

## Si algo falla

**`NVS no inicializado o namespace 'config' ausente`** — el ESP32 no encontró las credenciales en NVS. Repite los pasos 3 y 4.

**`ESP_ERR_NVS_NOT_FOUND`** — falta alguna clave en el CSV. Verifica que el CSV tiene exactamente las cinco claves: `wifi_ssid`, `wifi_pass`, `mqtt_uri`, `unit_id`, `api_key`.

**MQTT se conecta pero el broker rechaza** — `unit_id` o `api_key` no coinciden con la DB. Verifica que los valores en el CSV son idénticos a los del seed en `deploy/db/schema.sql`.

**Necesito cambiar de sim-001 a sim-002** — edita `nvs_config.csv` con los valores de sim-002, repite los pasos 3 y 4. No es necesario recompilar ni re-flashear el firmware.

---

## Provisionar un segundo ESP32

El binario compilado es el mismo para todos los dispositivos. Para sim-002:

1. Edita `nvs_config.csv` con las credenciales de sim-002
2. Genera el binario NVS (paso 3)
3. Flashea NVS en el segundo ESP32 (paso 4)
4. Flashea el firmware: `idf.py -C firmware/simulator -p COM5 flash monitor` (ajusta el puerto)
