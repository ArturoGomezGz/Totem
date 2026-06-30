# Rediseño del Frontend — Documento de Diseño

Este documento captura los requerimientos, decisiones de diseño e implicaciones técnicas del rediseño del frontend de Totem. Es el punto de partida obligatorio antes de escribir cualquier código.

---

## 1. Contexto

El frontend actual (`frontend/src/`) es una demo funcional con estilos inline en negro (`#111`) que sirve para probar la API, el WebSocket y el flujo de comandos. No tiene identidad visual, no sigue el design system de CIBNOR y no implementa las funcionalidades de personalización que el sistema necesita.

**El objetivo del rediseño es:**
- Aplicar el CIBNOR Design System a todas las vistas
- Introducir un dashboard modular donde el usuario controla qué variables ve
- Sentar las bases de una UI/UX de calidad de producción

---

## 2. Design System — CIBNOR

El proyecto tiene un design system definido en Claude Design (`e8cd7054-e51a-462e-8028-79bd18405c56`). Sus reglas de aplicación para Totem:

### Paleta de colores

| Token | Hex | Uso en Totem |
|---|---|---|
| `--blue-900` | `#003A5C` | Navbar, header, superficies primarias |
| `--blue-700` | `#0077AA` | Botones primarios, links, CTAs |
| `--teal-500` | `#00A99D` | Acento de hover, badges de estado activo |
| `--green-500` | `#4BAE8A` | Estado de bomba encendida, éxito |
| `--status-danger` | `#C4453B` | Alertas críticas, bomba apagada en contexto de error |
| `--status-warning` | `#E0A52B` | Alertas no críticas, sin señal |
| `--blue-050` | `#E0EBF0` | Superficies sunken, fondos de secciones alternas |
| `--ink-900` | `#1A2533` | Texto principal |
| `--ink-500` | `#5a6675` | Texto secundario, labels |

El tema es **claro** (fondo blanco / `--blue-050`), no el negro actual.

### Tipografía

- **Barlow** (Google Fonts) — headings, eyebrows, el nombre "TOTEM"
- **Source Sans 3** — cuerpo de texto, labels, UI en general
- **IBM Plex Mono** — valores numéricos de sensores, API keys, timestamps

### Componentes disponibles

El design system incluye: `Button`, `IconButton`, `Link`, `Input`, `Select`, `Checkbox`, `Card`, `StatCard`, `Badge`, `Tag`, `Alert`, `Tabs`, `Breadcrumb`.

Todos están en `components/` del proyecto de Claude Design como archivos `.jsx` listos para usar.

### Iconografía

**Lucide Icons** — CDN o paquete `lucide-react`. Stroke de ~1.75, color heredado del texto. Sin emoji.

---

## 3. Inventario de vistas

### Rutas actuales (se conservan)

```
/login
/register
/organizations
/organizations/:orgId/units
/organizations/:orgId/units/:unitId
/organizations/:orgId/profiles
```

### Navegación

El frontend actual no tiene navegación lateral ni navbar persistente — cada página tiene su propio header mínimo con botón "volver". En el rediseño se propone una **barra de navegación superior fija** (`--navbar-height: 72px`) con:
- Logo TOTEM (Barlow, bold, navy) + breadcrumb contextual
- Indicador de organización activa
- Avatar / menú de usuario
- Badge de estado de conexión WebSocket

La navbar desaparece en móvil y se convierte en bottom nav con tabs principales.

### Vistas a rediseñar

| Vista | Archivo actual | Prioridad |
|---|---|---|
| Login | `Login.jsx` | Alta |
| Registro | `Register.jsx` | Alta |
| Organizaciones | `Organizations.jsx` | Alta |
| Lista de unidades | `Units.jsx` | Alta |
| Detalle de unidad | `UnitDetail.jsx` | **Máxima** — contiene el dashboard modular |
| Perfiles de cultivo | `Profiles.jsx` | Media |

---

## 4. Feature clave: Dashboard modular

Es la funcionalidad más importante del rediseño. El usuario debe poder elegir qué variables quiere ver en su vista de detalle de unidad.

### 4.1 Concepto

Cada variable del sistema (sensor o control) se convierte en un **Widget** — una tarjeta autocontenida que muestra su dato en tiempo real. El usuario puede activar/desactivar widgets y reordenarlos para construir su vista personalizada.

```
Vista "En vivo" por defecto        Vista configurada (usuario 2)
┌──────────────┐ ┌──────────────┐  ┌──────────────────────────┐
│ Temperatura  │ │  Humedad     │  │       Temperatura        │
│   23.4 °C    │ │   65 %       │  │          23.4 °C         │
└──────────────┘ └──────────────┘  └──────────────────────────┘
┌──────────────┐ ┌──────────────┐  ┌──────────────┐
│   Luz PAR    │ │    CO₂       │  │   Luz PAR    │
│   412 µmol   │ │  820 ppm     │  │   412 µmol   │
└──────────────┘ └──────────────┘  └──────────────┘
┌─────────────────────────────────┐
│   Control de Bomba              │
│   ⬤ BOMBA ENCENDIDA  [APAGAR] │
└─────────────────────────────────┘
```

### 4.2 Catálogo de widgets

| ID | Tipo | Label | Unidad | Fuente |
|---|---|---|---|---|
| `temperature` | StatCard | Temperatura | °C | WS readings |
| `humidity` | StatCard | Humedad relativa | % | WS readings |
| `light` | StatCard | Luz PAR | µmol/m²/s | WS readings |
| `co2` | StatCard | CO₂ | ppm | WS readings |
| `pump_control` | Control | Control de bomba | — | WS + commands |
| `active_profile` | Config | Perfil activo | — | REST |
| `connection_status` | Status | Estado de conexión | — | WS |

Los widgets de `readings` muestran también el timestamp de la última lectura al hover.

### 4.3 Modo de edición

El usuario activa "Personalizar vista" mediante un botón icono (lápiz / Lucide `Settings2`) en el header de la sección. En modo edición:

1. Cada widget muestra un toggle (visible / oculto)
2. Aparece un panel lateral o sheet con todos los widgets disponibles (incluidos los ocultos)
3. El usuario puede arrastrar para reordenar (fase 2) o usar flechas arriba/abajo (fase 1)
4. Botón "Guardar" aplica y sale del modo edición
5. Botón "Restaurar predeterminado" vuelve al estado inicial

El modo edición **no** debe interferir con los datos en tiempo real — el WS sigue activo.

### 4.4 Persistencia de la configuración

**Decisión: localStorage por unidad, bajo la clave `totem:unit:{unitId}:widgets`**

```jsonc
// Estructura guardada
{
  "visible": ["temperature", "humidity", "light", "co2", "pump_control"],
  "order": ["temperature", "humidity", "pump_control", "light", "co2"],
  "hiddenAvailable": ["active_profile", "connection_status"]
}
```

**Por qué localStorage y no base de datos:**
- Cero cambios de backend para esta feature
- La configuración es personal a este dispositivo/navegador, lo cual es correcto para un dashboard de monitoreo de campo
- Simple, sin latencia, sin estado de carga

**Implicación futura:** Si se implementa autenticación multi-dispositivo o la App Móvil Nativa de `docs/planned-features.md`, habrá que migrar estas preferencias a una tabla `user_unit_preferences` en la base de datos.

### 4.5 Implicaciones de layout

El layout de widgets usa CSS Grid con `auto-fit` para adaptarse a distintos números de columnas según el ancho de pantalla:

```css
.widget-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-4);
}
```

El widget `pump_control` ocupa el 100% del ancho (span completo) por ser una acción crítica — no debe quedar encogido en una celda pequeña. Igual para `active_profile`.

Los widgets StatCard usan el componente `StatCard` del design system con accents diferenciados:
- Temperatura → `--teal-500`
- Humedad → `--blue-700`
- Luz PAR → `--lime-500`
- CO₂ → `--ink-500`

---

## 5. Estructura propuesta del frontend

### Stack (sin cambios)

React + Vite. Se mantiene por continuidad y por el plan de React Native en `docs/planned-features.md`.

### Librerías nuevas a instalar

| Librería | Por qué |
|---|---|
| `lucide-react` | Iconografía del design system |
| `@dnd-kit/core` + `@dnd-kit/sortable` | Drag-and-drop de widgets (fase 2, opcional en fase 1) |

Ninguna librería de componentes externa (MUI, Ant, Chakra) — se usan los componentes del CIBNOR DS.

### Estructura de carpetas propuesta

```
frontend/src/
├── design-system/          ← Componentes importados del CIBNOR DS
│   ├── tokens/             ← colors.css, typography.css, spacing.css, fonts.css
│   ├── Button.jsx
│   ├── Card.jsx
│   ├── StatCard.jsx
│   ├── Alert.jsx
│   ├── Tabs.jsx
│   ├── Breadcrumb.jsx
│   ├── Badge.jsx
│   ├── Tag.jsx
│   ├── Input.jsx
│   ├── Select.jsx
│   └── index.js            ← re-exports
├── components/
│   ├── Navbar.jsx
│   ├── widgets/
│   │   ├── WidgetGrid.jsx      ← Grid + modo edición
│   │   ├── TemperatureWidget.jsx
│   │   ├── HumidityWidget.jsx
│   │   ├── LightWidget.jsx
│   │   ├── Co2Widget.jsx
│   │   ├── PumpControlWidget.jsx
│   │   ├── ActiveProfileWidget.jsx
│   │   └── ConnectionStatusWidget.jsx
│   ├── ReadingsChart.jsx
│   ├── EventsList.jsx
│   ├── AlertsList.jsx
│   └── ProtectedRoute.jsx
├── hooks/
│   ├── useUnitWebSocket.js     ← Extrae la lógica WS de UnitDetail
│   ├── useWidgetPrefs.js       ← Lee/escribe config en localStorage
│   └── useUnit.js              ← Fetches REST de unidad/perfil
├── pages/
│   ├── Login.jsx
│   ├── Register.jsx
│   ├── Organizations.jsx
│   ├── Units.jsx
│   ├── UnitDetail.jsx          ← Usa hooks + widgets
│   └── Profiles.jsx
├── api.js
├── App.jsx
├── index.css                   ← @import design-system/tokens/*
└── main.jsx
```

---

## 6. Reglas de UI/UX por aplicar en todo el frontend

Derivadas del design system CIBNOR y del principio de bajo costo/replicabilidad:

1. **Sin emoji.** Ni en UI ni en código. El sistema es institucional y científico.
2. **Tema claro.** Fondo blanco / `--blue-050`. El dark mode no es prioritario — si se añade, será posterior.
3. **Texto en español institucional.** Sentence case en headings. Eyebrows en UPPERCASE con `--tracking-caps`. Sin camelCase en labels visibles al usuario.
4. **Valores numéricos en IBM Plex Mono.** Temperatura, humedad, CO₂, PAR, timestamps.
5. **Feedback visual de estado.** Todo botón que dispara una acción async muestra estado loading / error / éxito. Los errores usan el componente `Alert` del DS, no párrafos con color rojo inline.
6. **Offline/sin señal explícito.** Si la unidad está offline, los widgets muestran `—` y un badge `SIN SEÑAL` en naranja/warning, nunca datos stale sin indicación.
7. **Acciones destructivas requieren confirmación.** Apagar la bomba manualmente es una acción con consecuencias — considerar un modal de confirmación o al menos un estado de doble-tap.
8. **Responsive mobile-first.** El layout base es de 1 columna en mobile (< 480px). Grid de 2+ columnas en tablet/desktop.

---

## 7. Cambios de backend necesarios

El rediseño del frontend **no requiere cambios de backend** para la feature de widgets modulares (se usa localStorage).

Sin embargo, hay dos mejoras menores que se recomienda añadir simultáneamente:

### 7.1 Endpoint de preferencias de usuario (opcional, fase 2)

Si se decide sincronizar la configuración de widgets entre dispositivos:

```
GET  /api/v1/users/me/preferences
PUT  /api/v1/users/me/preferences
```

Body: `{ "unit_widgets": { "<unitId>": { "visible": [...], "order": [...] } } }`

Schema: columna `preferences JSONB` en la tabla `users`.

### 7.2 Endpoint de métricas de la unidad (opcional, mejora UX)

Para mostrar un resumen rápido en la lista de unidades (temperatura actual, estado de bomba):

```
GET /api/v1/organizations/:orgId/units  (ya existe)
```

Si la respuesta ya incluye `last_reading` y `pump_on` en cada unidad, el dashboard de lista puede mostrar un preview sin abrir el detalle. Verificar si el endpoint actual lo devuelve o si hay que añadirlo.

---

## 8. Fases de implementación

### Fase 1 — Base visual y estructura (sin feature de widgets)

1. Copiar tokens y componentes del CIBNOR DS a `frontend/src/design-system/`
2. Reescribir `index.css` importando los tokens
3. Crear `Navbar.jsx` con logo, breadcrumb y badge de conexión
4. Rediseñar Login y Register aplicando DS
5. Rediseñar Organizations y Units con Cards del DS
6. Rediseñar UnitDetail con Tabs del DS, StatCards para sensores
7. Extraer lógica WS a `useUnitWebSocket.js` y lógica de perfiles a `useUnit.js`

**Criterio de completitud:** todas las vistas usan tokens del DS, sin colores hardcodeados.

### Fase 2 — Dashboard modular (feature de widgets)

1. Implementar `useWidgetPrefs.js` con lectura/escritura en localStorage
2. Crear componentes individuales de widget (`TemperatureWidget`, etc.)
3. Implementar `WidgetGrid.jsx` con layout y modo edición por toggles
4. Añadir panel de "Personalizar vista" en UnitDetail
5. Implementar restaurar predeterminado

**Criterio de completitud:** un usuario puede ocultar/mostrar variables y la configuración persiste al recargar la página.

### Fase 3 — Drag-and-drop y pulido (opcional, post-MVP)

1. Integrar `@dnd-kit` para reordenamiento por arrastre
2. Animaciones de entrada/salida de widgets (`--duration-slow`, `--ease-out`)
3. Migrar preferencias a backend si se implementa multi-dispositivo

---

## 9. Decisiones cerradas en este documento

| Decisión | Elección |
|---|---|
| ¿Tema claro u oscuro? | Claro (CIBNOR DS es claro) |
| ¿Persistencia de widgets? | localStorage por unitId (sin cambios de backend en fase 1-2) |
| ¿Librería de drag-and-drop? | `@dnd-kit` (fase 3, si se decide implementar) |
| ¿Librería de componentes externa? | No — se usan los del CIBNOR DS |
| ¿Iconos? | Lucide (`lucide-react`) |
| ¿Fuentes? | Barlow + Source Sans 3 + IBM Plex Mono (Google Fonts) |
| ¿Cambiar rutas? | No — se conservan las rutas actuales |

---

## 10. Decisiones cerradas (actualización)

| Decisión | Elección |
|---|---|
| ¿El widget de bomba requiere confirmación? | **No** — tap directo, sin modal ni doble confirmación |
| ¿Los widgets pueden cambiar de tamaño? | **No** — solo visible u oculto; todos los widgets tienen el mismo tamaño de celda |
