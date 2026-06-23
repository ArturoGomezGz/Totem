# Capa 2 — Servidor, Web y Servicios

Todo lo que no toca hardware directamente. Deployment-agnostic: la misma codebase corre en Raspberry Pi, VPS o cloud sin modificaciones. Se levanta con `docker compose up` desde `deploy/`.

## Componentes

| Componente | Responsabilidad |
|---|---|
| Broker MQTT (Mosquitto) | Punto de entrada de dispositivos — autentica conexiones, enruta mensajes entre ESP32 y API |
| API REST (FastAPI) | Suscrita al broker para persistir lecturas, eventos y alertas; publica comandos y perfiles a dispositivos; expone histórico al dashboard; gestiona OTA |
| Base de Datos (TimescaleDB) | Series de tiempo para lecturas + tablas relacionales para metadatos |
| Dashboard (React + Vite) | Visualización, control manual, gestión de perfiles |
| Bot de Telegram | Notificaciones al usuario; bidireccional en versión futura |

## Documentos

- `capa2/stack.md` — decisiones de tecnología y justificaciones
- `capa2/api-contract.md` — endpoints, payloads y autenticación
- `capa2/schema.md` — esquema completo de base de datos
