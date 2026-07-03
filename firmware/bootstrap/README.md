# Firmware bootstrap (base de fábrica)

Es el único binario que se flashea por USB en una unidad Totem nueva. No sensa, no riega, no maneja perfiles ni alertas — su único trabajo es:

1. Conectar a WiFi/MQTT con las credenciales que ya estén en NVS (mismo formato que `firmware/simulator`, ver `nvs_config.csv.example`).
2. Reportar su versión (`1.0.0`) al server vía `totem/{unit_id}/status`.
3. Esperar el primer OTA (`totem/{unit_id}/ota`) hacia un firmware con funcionalidad real — normalmente el que vive en `firmware/simulator`.

A partir de ese primer OTA, el ciclo de vida completo del dispositivo es vía OTA — este binario no se vuelve a flashear por USB salvo que se necesite recuperar una unidad manualmente.

## Por qué existe

Antes, cada unidad nueva requería flashear por USB el binario completo (sensores, bomba, alertas, modelo de decisión) y ese binario cambia con cada feature. Con `bootstrap`, el binario que se flashea por USB casi nunca cambia — es siempre el mismo firmware mínimo — y todo lo demás se entrega por OTA, que ya está probado end-to-end en hardware real (ver `firmware/simulator`).

## Provisioning

Idéntico al de `firmware/simulator` — mismas claves NVS (`wifi_ssid`, `wifi_pass`, `mqtt_uri`, `unit_id`, `api_key`), mismo namespace `config`. Sigue `firmware/simulator/PROVISIONING.md` reemplazando `firmware/simulator` por `firmware/bootstrap` en los comandos de `idf.py`. La partición NVS no se toca durante un OTA, así que una unidad flasheada con `bootstrap` conserva las mismas credenciales al actualizarse a cualquier versión posterior.

## Flujo para una unidad nueva

1. Admin registra la unidad en el dashboard → obtiene `unit_id` y `api_key`.
2. Se provisiona NVS con esas credenciales (como en `firmware/simulator/PROVISIONING.md`).
3. Se flashea este binario por USB: `idf.py -C firmware/bootstrap -p COM4 build flash monitor`.
4. El dispositivo conecta, reporta `firmware_version: "1.0.0"` y queda a la espera.
5. Desde el panel de administración de Firmware, se aplica (deploy) la versión real deseada a esa unidad. El dispositivo la descarga, verifica el SHA-256, y reinicia con la nueva versión — sin volver a tocar el USB.
