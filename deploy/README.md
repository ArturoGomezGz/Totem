# Deploy

Stack completo levantado con `docker compose up` desde este directorio.

## Servicios

| Servicio | Puerto | Descripción |
|---|---|---|
| `totem-mosquitto` | 1883 | Broker MQTT |
| `totem-api` | 8000 | API REST (FastAPI) |
| `totem-frontend` | 80 | Dashboard web (React) |

## Credenciales de desarrollo

### Mosquitto

| Usuario | Contraseña | Rol |
|---|---|---|
| `sim-001` | `nueva-password` | Simulador / ESP32 de prueba |
| `server` | *(ver configuración inicial)* | FastAPI — suscriptor interno |

Para agregar o cambiar la contraseña de un usuario:
```
docker exec totem-mosquitto mosquitto_passwd -b /mosquitto/config/passwd <usuario> <password>
docker restart totem-mosquitto
```

Para verificar conectividad:
```
docker exec totem-mosquitto mosquitto_pub -h localhost -p 1883 -u sim-001 -P nueva-password -t "totem/sim-001/test" -m "ping"
```

## Notas

- Las credenciales de este archivo son para desarrollo local únicamente.
- El archivo `mosquitto/config/passwd` no debe commitearse al repositorio.
