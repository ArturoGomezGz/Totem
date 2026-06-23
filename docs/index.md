# Documentación Totem — Índice

El repositorio es la fuente de verdad. Todo lo técnico vive aquí.

---

## Ecosistema Totem

```
Ecosistema Totem
│
├── Capa 1 — Microcontrolador y Hardware (ESP32)
│   │
│   ├── Totem Principal  (siempre presente)
│   │   ├── Sistema de Decisión de Riego
│   │   │   ├── Módulo de Lectura de Sensores
│   │   │   └── Módulo de Decisión (ML + Perfil de Cultivo Activo)
│   │   ├── Sistema de Riego
│   │   │   ├── Módulo de Suministro  (nivel + válvula NC)
│   │   │   └── Módulo de Actuación   (bomba + aspersores)
│   │   └── Sistema de Conectividad
│   │
│   └── Tanque de Suministro  (opcional, independiente)
│       │   Alimenta 1..N Totems — sustituible por llave de agua
│       ├── Módulo de Flotadores
│       └── Sistema de Conectividad
│
└── Capa 2 — Servidor, Web y Servicios  (compartida por todas las unidades)
    ├── API REST (FastAPI)
    ├── Base de Datos (TimescaleDB)
    ├── Dashboard (React + Vite)
    └── Bot de Telegram
```

---

## Documentos

### Visión general del ecosistema
| Documento | Descripción |
|---|---|
| `ecosistema/overview.md` | Arquitectura de dos capas, decisiones tomadas y pendientes |
| `ecosistema/project-structure.md` | Estructura de carpetas del repositorio |
| `ecosistema/diagramas/arquitectura.md` | Componentes y flujos de datos (base para diagramas) |
| `requirements.md` | Requerimientos funcionales (FR) y no funcionales (NFR) |
| `evaluation-framework.md` | Marco de evaluación del sistema por versión |
| `planned-features.md` | Features identificadas fuera del alcance del MVP |

### Capa 1 — Totem Principal
| Documento | Descripción |
|---|---|
| `capa1/overview.md` | Las dos unidades de Capa 1 y su relación |
| `capa1/totem-principal/sistema-decision/sistema-decision.md` | Sistema de Decisión de Riego — visión general |
| `capa1/totem-principal/sistema-decision/modulo-lectura-sensores.md` | Módulo de Lectura de Sensores |
| `capa1/totem-principal/sistema-decision/modulo-decision.md` | Módulo de Decisión — ML, Pn, umbrales |
| `capa1/totem-principal/sistema-riego/sistema-riego.md` | Sistema de Riego — visión general |
| `capa1/totem-principal/sistema-riego/modulo-suministro.md` | Módulo de Suministro — nivel de tanque y válvula NC |
| `capa1/totem-principal/sistema-riego/modulo-actuacion.md` | Módulo de Actuación — bomba y aspersores |
| `capa1/totem-principal/sistema-conectividad/sistema-conectividad.md` | Sistema de Conectividad — MQTT, buffer offline, OTA |

### Capa 1 — Tanque de Suministro
| Documento | Descripción |
|---|---|
| `capa1/tanque-de-suministro/sistema-tanque-suministro.md` | Sistema completo — integración, gravedad, 1..N Totems |
| `capa1/tanque-de-suministro/modulo-flotadores.md` | Módulo de Flotadores — nivel de solución disponible |
| `capa1/tanque-de-suministro/sistema-conectividad/sistema-conectividad.md` | Sistema de Conectividad — reporta nivel a Capa 2 |

### Capa 2 — Servidor, Web y Servicios
| Documento | Descripción |
|---|---|
| `capa2/overview.md` | Componentes de la Capa 2 y cómo se relacionan |
| `capa2/stack.md` | Decisiones de stack — FastAPI, Mosquitto, TimescaleDB, React, Telegram |
| `capa2/api-contract.md` | Contrato de API — endpoints, payloads, autenticación |
| `capa2/schema.md` | Esquema de base de datos |

### Transversal
| Documento | Descripción |
|---|---|
| `transversal/crop-profile.md` | Perfil de Cultivo Activo — parámetros, ciclo de vida |
