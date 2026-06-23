# Estructura del proyecto

```
totem/
├── firmware/       # Capa 1 — ESP32 (C++, PlatformIO)
├── server/         # Capa 2 — Backend (stack pendiente de decidir)
├── frontend/       # Capa 2 — Dashboard web (framework pendiente de decidir)
├── simulator/      # Generador de lecturas sintéticas — cliente del server
├── ml/             # Modelo de estimación de Pn (tasa de fotosíntesis)
├── deploy/         # Orquestación central del stack (Docker Compose)
└── docs/           # Documentación que debe vivir con el código
```

## Criterios de organización

**`firmware/` y `server/` son independientes por diseño.** La Capa 1 (ESP32) opera sin la Capa 2 — si el server cae, el riego sigue funcionando. Ninguno depende del código del otro; solo comparten el contrato de API (ver `docs/capa2/api-contract.md`).

**`deploy/` es el punto central de orquestación.** Los `Dockerfile` de cada servicio vivirán dentro de su carpeta respectiva; `deploy/` contiene el `docker-compose.yml` que los orquesta juntos. Un tercero puede levantar el stack completo con `docker compose up` desde `deploy/`.

**`simulator/` es un cliente del server, no parte de él.** Puede apuntar a cualquier instancia (local, staging, producción) y es la herramienta principal para desarrollar DB, frontend y ML antes de tener hardware físico.

**`ml/` es independiente del server** porque el flujo de trabajo de entrenamiento (notebooks, datasets, experimentos) es distinto al del servidor. Los modelos entrenados se exportan al firmware como `.tflite` — la inferencia corre en el ESP32, no en el server (decisión cerrada, 22 jun 2026).
