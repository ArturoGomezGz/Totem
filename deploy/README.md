# Deploy

Stack completo levantado con `docker compose up` desde este directorio.

## Base de datos

El esquema lo crean las **migraciones Alembic** automáticamente: el contenedor `totem-api` ejecuta `alembic upgrade head` antes de levantar la API. No hay que ejecutar ningún SQL a mano — ver `docs/capa2/migraciones-alembic.md`.

Para cargar los datos de prueba de desarrollo (org de prueba, admin, unidades sim-001/sim-002), opcional y solo después del primer arranque del api:

```
docker compose exec -T db psql -U $POSTGRES_USER -d $POSTGRES_DB < db/seed.dev.sql
```

> **Entornos creados antes de Alembic** (con el antiguo `db/schema.sql`): reconstruirlos de cero con `docker compose down -v && docker compose up -d --build`. Es la única vez que se pierde el volumen — a partir de ahí las migraciones actualizan el esquema sin destruir datos.

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
