---
name: "file-bug-issue"
description: "Convierte un reporte de bug del usuario (frontend o backend) en un issue de GitHub bien fundamentado, con causa raíz verificada en el código. Úsala cuando el usuario reporte uno o varios bugs y pida levantarlos como issues, en vez de arreglarlos de inmediato."
---

### Objetivo
Producir issues de GitHub accionables de una sola vez — sin necesitar otra ronda de investigación cuando se trabajen después. Cada issue debe reflejar la causa raíz real del bug, verificada en el código, no solo el síntoma que reportó el usuario. Esto evita issues vagos o duplicados que cuesten más triar que arreglar.

### Reglas de Formato

* **Un issue por bug real**, no por síntoma reportado. Si dos síntomas comparten la misma causa raíz, es un solo issue.
* **Explorar antes de redactar.** Nunca crear un issue solo con la descripción del usuario — localizar el código relevante (`file_path:line_number`) y confirmar el comportamiento actual antes de escribir el issue.
* **Causa raíz, no solo síntoma.** Si el síntoma reportado no coincide con lo que hace el código (ej. "el error no se muestra" pero el componente sí tiene lógica para mostrarlo), investigar más profundo — el bug suele estar en otra capa (ver ejemplo de interceptor 401 más abajo).
* **Señalar bloqueos de diseño explícitamente.** Si el fix correcto requiere una decisión de arquitectura/diseño que no existe aún en el código (ej. un concepto que no está implementado), el issue debe nombrar las opciones en vez de asumir una solución.
* **Confirmar ambigüedad con el usuario antes de crear el issue**, no después. Usar preguntas puntuales de opción múltiple cuando haya más de una causa raíz plausible o más de un diseño posible.
* **Estructura de cada issue:**
  - `## Descripción` — qué pasa hoy, con paths y líneas exactas.
  - `## Causa raíz` (solo si no es obvia del síntoma) — por qué pasa, con snippet de código.
  - `## Comportamiento esperado` — qué debería pasar en su lugar.
  - `## Notas técnicas` / `## Bloqueante de diseño` — contexto adicional, decisiones pendientes, opciones a evaluar.

### Pasos a ejecutar

1. Recopilar del usuario la lista de síntomas reportados (aunque sea informal).
2. Explorar el código relevante para cada síntoma — usar Explore/Grep, nunca asumir. Para tareas de exploración amplia, delegar a un agente Explore en lugar de hacerlo inline.
3. Para cada síntoma, verificar si el código hace lo que el usuario describe o si hay una discrepancia (el síntoma reportado no siempre es la causa raíz — seguir la cadena de llamadas hasta encontrarla).
4. Si hay ambigüedad sobre la causa real o sobre el diseño de la solución, preguntar al usuario con opciones concretas antes de redactar el issue.
5. Redactar cada issue en el formato de la sección anterior y mostrárselo al usuario antes de publicarlo.
6. Crear los issues con `gh issue create --repo <owner>/<repo> --title "..." --body "$(cat <<'EOF' ... EOF)"`.
7. Confirmar al usuario los números/URLs de los issues creados.

### Plantilla o Ejemplo

**Ejemplo real — bug con causa raíz distinta al síntoma reportado:**

Síntoma reportado: "si el login falla nunca dice credenciales incorrectas ni ningún feedback."

Investigación: `Login.jsx` sí tenía `{error && <Alert tone="danger">{error}</Alert>}` — el síntoma no cuadraba con el código. Se siguió la cadena hasta `api.js`, donde un interceptor global de 401 hacía `window.location.href = '/login'` para *cualquier* 401 (incluido el de credenciales inválidas), impidiendo que el error llegara a lanzarse.

```bash
gh issue create --repo ArturoGomezGz/Totem \
  --title "Login fallido no muestra ningún feedback (interceptor 401 global redirige antes de mostrar el error)" \
  --body "$(cat <<'EOF'
## Descripción

Al fallar el login (credenciales incorrectas), no aparece ningún mensaje de error al usuario, a pesar de que `Login.jsx` sí tiene la lógica para mostrarlo (`frontend/src/pages/Login.jsx:78`).

## Causa raíz

El bug no está en `Login.jsx`, está en el interceptor global de `frontend/src/api.js:30-34`:

\`\`\`js
if (res.status === 401) {
  clearTokens()
  window.location.href = '/login'
  return
}
\`\`\`

Esta función intercepta cualquier 401 — incluido el de `/auth/login` — y redirige antes de lanzar el error.

## Comportamiento esperado

El interceptor de expiración de sesión debe aplicar solo a peticiones autenticadas, no a `/auth/login` ni `/auth/register`.
EOF
)"
```

**Ejemplo real — bug con bloqueante de diseño:**

Síntoma reportado: "después de crear una organización redirige a /organizations vacía, en su lugar debería ir a units de la org recién creada."

Investigación: no existe ningún concepto de "organización activa" ni ruta anidada `/organizations/:id/units`. En vez de asumir una solución, el issue nombró ambas opciones (contexto de organización activa vs. ruta anidada) y quedó marcado como bloqueado por esa decisión hasta que se resuelva al trabajarlo.
