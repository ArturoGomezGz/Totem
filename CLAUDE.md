# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ¿Qué es Totem?

Sistema aeropónico vertical modular, solar y de código abierto para producción de alimentos. El código de este repo implementa la capa de software del sistema: firmware para ESP32 y un servidor de monitoreo y control.

---

## Documentación

**El repositorio es la fuente de verdad completa y más actualizada.** Todos los documentos técnicos — decisiones cerradas, decisiones pendientes, contratos de API y esquemas — viven en `docs/`. Durante el desarrollo no es necesario consultar Notion.

Notion se usa exclusivamente como capa de presentación limpia: módulos bien descritos, requerimientos organizados, contenido ya cerrado. No refleja work-in-progress ni decisiones pendientes.

El índice completo de documentos vive en `docs/index.md`. Referencia rápida:

| Área | Documento local |
|---|---|
| Índice maestro | `docs/index.md` |
| Arquitectura del ecosistema | `docs/ecosistema/overview.md` |
| Estructura de carpetas | `docs/ecosistema/project-structure.md` |
| Diagrama de componentes y flujos | `docs/ecosistema/diagramas/arquitectura.md` |
| Requerimientos (FR y NFR) | `docs/requirements.md` |
| Marco de evaluación del sistema | `docs/evaluation-framework.md` |
| Features planificadas (post-MVP) | `docs/planned-features.md` |
| Capa 1 — visión general (dos unidades) | `docs/capa1/overview.md` |
| Sistema de Decisión de Riego | `docs/capa1/totem-principal/sistema-decision/sistema-decision.md` |
| Módulo de Lectura de Sensores | `docs/capa1/totem-principal/sistema-decision/modulo-lectura-sensores.md` |
| Módulo de Decisión (ML + Pn) | `docs/capa1/totem-principal/sistema-decision/modulo-decision.md` |
| Sistema de Riego | `docs/capa1/totem-principal/sistema-riego/sistema-riego.md` |
| Módulo de Suministro (nivel + válvula) | `docs/capa1/totem-principal/sistema-riego/modulo-suministro.md` |
| Módulo de Actuación (bomba) | `docs/capa1/totem-principal/sistema-riego/modulo-actuacion.md` |
| Sistema de Conectividad (Totem) | `docs/capa1/totem-principal/sistema-conectividad/sistema-conectividad.md` |
| Tanque de Suministro | `docs/capa1/tanque-de-suministro/sistema-tanque-suministro.md` |
| Módulo de Flotadores | `docs/capa1/tanque-de-suministro/modulo-flotadores.md` |
| Sistema de Conectividad (Tanque) | `docs/capa1/tanque-de-suministro/sistema-conectividad/sistema-conectividad.md` |
| Capa 2 — visión general | `docs/capa2/overview.md` |
| Stack técnico | `docs/capa2/stack.md` |
| Contrato de API | `docs/capa2/api-contract.md` |
| Esquema de base de datos | `docs/capa2/schema.md` |
| Perfil de Cultivo Activo | `docs/transversal/crop-profile.md` |

---

## Arquitectura

El sistema tiene dos capas independientes. Ver `docs/ecosistema/overview.md` para el detalle completo.

**Capa 1 — Firmware ESP32 (`firmware/`):** sensado, decisión autónoma de riego via estimación de Pn (tasa de fotosíntesis) con modelo `.tflite` embebido en el ESP32, buffer offline, OTA. Opera sin internet — la función crítica de riego nunca depende de la Capa 2.

**Capa 2 — Server (`server/`, `frontend/`):** base de datos, API REST, dashboard web, alertas vía bot de Telegram. Deployment-agnostic: misma codebase en Raspberry Pi, VPS o cloud. Se levanta con `docker compose up` desde `deploy/`.

**`simulator/`:** genera lecturas sintéticas y las envía al server igual que el ESP32 — permite desarrollar el stack completo sin hardware físico.

**`ml/`:** entrenamiento del modelo de estimación de Pn. Los modelos exportados van al firmware como `.tflite` — la inferencia corre en el ESP32, no en el server.

Estructura de carpetas: `docs/project-structure.md`

---

## Principios de diseño (aplicar en cada decisión técnica)

- **Bajo costo y replicabilidad primero.** Un tercero debe poder construir y replicar el sistema con materiales locales. Si una decisión técnica encarece o complica la replicación, hay que justificarla explícitamente.
- **Capa 1 siempre autónoma.** El riego nunca puede depender de conectividad. Cualquier código en el firmware debe funcionar correctamente sin server.
- **Server deployment-agnostic.** El mismo código debe correr sin modificaciones en RPi, VPS o cloud. Las limitaciones de entorno (sin salida a internet, sin notificaciones push) son limitaciones de deployment, no bugs.
- **Modularidad.** Los módulos del firmware (irrigation, sensors, connectivity, storage) deben ser intercambiables. El simulador y el ESP32 son intercambiables desde la perspectiva del server — ambos usan el mismo contrato de API.

---

## Decisiones técnicas pendientes

Ver detalle completo en `docs/ecosistema/overview.md`. Resumen de lo que bloquea el inicio de implementación:

**Firmware ↔ server — interfaz:**
- Intervalo del ciclo de decisión y publicación MQTT
- Aprovisionamiento de unidades (cómo llega la API key al ESP32)
- Política del buffer offline (tamaño, descarte, retry)
- Confirmación de ejecución de comandos
- Comportamiento en primer arranque (factory state)
- Frescura del perfil cacheado (TTL)
- Configuración de sesiones MQTT (clean vs. persistent session)
- Manejo de fallo de autenticación MQTT

**ML:**
- Algoritmo para estimación de Pn (SVR, BPNN, ANN u otro)
- Función Pn → duración de ciclo de riego

No implementar estas áreas sin haber cerrado la decisión correspondiente. Ver `docs/ecosistema/overview.md` para el contexto completo de cada ítem.

---

## Estado actual

Etapa de diseño — no hay código todavía. Stack técnico y contrato de API definidos (ver `docs/`). Las decisiones pendientes del firmware listadas arriba bloquean su implementación. El punto de partida recomendado es el simulador de sensores, ya que desbloquea el desarrollo del server y el dashboard sin necesitar hardware ni resolver las decisiones del firmware.
