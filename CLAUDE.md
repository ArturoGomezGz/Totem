# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ¿Qué es Totem?

Sistema aeropónico vertical modular, solar y de código abierto para producción de alimentos. El código de este repo implementa la capa de software del sistema: firmware para ESP32 y un servidor de monitoreo y control.

Documentación completa del proyecto: [Notion — Totem](https://app.notion.com/p/3819cfa57faf8043ac83cd09d101dc25)

---

## Arquitectura

El sistema tiene dos capas independientes. Ver `docs/architecture.md` para el detalle completo.

**Capa 1 — Firmware ESP32 (`firmware/`):** sensado, decisión autónoma de riego via estimación de Pn (tasa de fotosíntesis), buffer offline, OTA. Opera sin internet — la función crítica de riego nunca depende de la Capa 2.

**Capa 2 — Server (`server/`, `frontend/`):** base de datos, API REST, dashboard web, alertas. Deployment-agnostic: misma codebase en Raspberry Pi, VPS o cloud. Se levanta con `docker compose up` desde `deploy/`.

**`simulator/`:** genera lecturas sintéticas y las envía al server igual que el ESP32 — permite desarrollar el stack completo sin hardware físico.

**`ml/`:** entrenamiento e inferencia del modelo de estimación de Pn. Los modelos exportados van al firmware (`.tflite`) o al server según donde corra la inferencia (pendiente de decidir).

Estructura de carpetas: `docs/project-structure.md`

---

## Principios de diseño (aplicar en cada decisión técnica)

- **Bajo costo y replicabilidad primero.** Un tercero debe poder construir y replicar el sistema con materiales locales. Si una decisión técnica encarece o complica la replicación, hay que justificarla explícitamente.
- **Capa 1 siempre autónoma.** El riego nunca puede depender de conectividad. Cualquier código en el firmware debe funcionar correctamente sin server.
- **Server deployment-agnostic.** El mismo código debe correr sin modificaciones en RPi, VPS o cloud. Las limitaciones de entorno (sin salida a internet, sin notificaciones push) son limitaciones de deployment, no bugs.
- **Modularidad.** Los módulos del firmware (irrigation, sensors, connectivity, storage) deben ser intercambiables. El simulador y el ESP32 son intercambiables desde la perspectiva del server — ambos usan el mismo contrato de API.

---

## Decisiones técnicas pendientes

Antes de implementar las siguientes áreas, hay decisiones abiertas que las bloquean:

- **Stack de Capa 2** — FastAPI + TimescaleDB + SQLAlchemy (sync) decididos (ver `docs/stack.md`). Desbloquea: esquema de DB, contrato de API.
- **Protocolo ESP32 ↔ server** — HTTP/REST vs. MQTT. Pendiente de decidir.
- **Algoritmo ML para Pn** — SVR, BPNN, ANN u otro. Ubicación de inferencia (dispositivo vs. server) pendiente. Ver [Notion — Módulo de Decisión de Riego](https://app.notion.com/p/3849cfa57faf80b0b57de6bf147fb988).
- **Función Pn → duración de ciclo de riego** — pendiente de definir.

No implementar estas áreas sin haber cerrado la decisión correspondiente.

---

## Estado actual

El proyecto está en etapa de inicio — no hay código todavía. El stack técnico y el contrato de API están pendientes de definir. El punto de partida recomendado es el simulador de sensores, ya que desbloquea el desarrollo del server y el dashboard sin necesitar hardware.
