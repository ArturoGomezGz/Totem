---
name: "endpoint-docs"
description: "Documenta endpoints FastAPI con el estándar Swagger/OpenAPI del proyecto Totem. Úsala cada vez que implementes un endpoint nuevo o revises uno existente."
---

### Objetivo
Producir documentación Swagger/OpenAPI completa, consistente y útil para cada endpoint, de modo que cualquier desarrollador — o usuario del dashboard — pueda entender qué hace, para qué sirve y dónde se usa, directamente desde la interfaz de Swagger UI. La documentación vive en el código, no en documentos separados.

### Reglas de Formato

* **Campos obligatorios:** todo endpoint lleva `summary`, `description`, `tags`, `response_model` y `responses`. Sin excepción.
* **`description` en Markdown:** FastAPI la renderiza en Swagger UI — usar negritas, listas y tablas cuando aporten claridad real. No usar Markdown decorativo que no añada información.
* **Tags:** usar únicamente los tags estándar del proyecto (ver tabla en plantilla). No inventar tags nuevos sin justificación.
* **`responses`:** incluir solo los códigos HTTP que el endpoint puede devolver realmente. No copiar toda la lista por defecto.
* **422:** FastAPI lo agrega automáticamente para errores de validación de tipos — no incluirlo manualmente.
* **Tabla de parámetros:** agregar en `description` cuando el endpoint acepta múltiples query params con comportamiento no obvio.
* **Ejemplos de request:** agregar `openapi_extra` con ejemplos solo cuando el body es complejo o admite variantes cualitativas distintas (no para bodies simples de 1-2 campos).
* **`response_description`:** agregar cuando la descripción del modelo Pydantic no es suficiente para entender qué devuelve el endpoint.
* **`deprecated=True`:** marcar endpoints que existen por compatibilidad pero no deben usarse en código nuevo.
* **Internos:** endpoints bajo `/api/internal/` siempre llevan `include_in_schema=False` y no requieren los demás campos.

### Pasos a ejecutar

1. Identificar el tipo de endpoint: ¿es público, autenticado o interno (`/api/internal/`)?
2. Si es interno: agregar `include_in_schema=False` y omitir el resto de pasos.
3. Asignar el tag correcto de la lista estándar.
4. Redactar `summary` (≤ 10 palabras, verbo + recurso, en español).
5. Redactar `description` respondiendo las tres preguntas: **¿Qué hace?** / **¿Para qué?** / **¿Dónde se usa?**
6. Evaluar si hay query params no triviales → agregar tabla de parámetros al final del `description`.
7. Evaluar si el body admite variantes importantes → agregar `openapi_extra` con ejemplos named.
8. Definir `response_model` con el esquema Pydantic de la respuesta exitosa (200/201).
9. Listar en `responses={}` solo los códigos HTTP que el endpoint puede devolver realmente.

### Plantilla o Ejemplo

**Tags estándar del proyecto:**

| Tag | Endpoints que agrupa |
|---|---|
| `auth` | Login, registro, refresh, logout |
| `organizations` | CRUD de organizaciones, membresías |
| `units` | CRUD de unidades, estado, asignación de perfil |
| `readings` | Histórico de lecturas de sensores |
| `events` | Histórico de eventos de actuadores |
| `alerts` | Historial y gestión de alertas |
| `profiles` | CRUD de perfiles de cultivo |
| `commands` | Envío de comandos manuales |
| `firmware` | OTA y releases de firmware |

**Códigos de error disponibles** (incluir solo los que apliquen):

| Código | Cuándo usarlo |
|---|---|
| 400 | Payload inválido o regla de negocio violada |
| 401 | Token ausente, inválido o expirado |
| 403 | El usuario no tiene permisos sobre este recurso |
| 404 | Recurso no encontrado |
| 409 | Conflicto — el recurso ya existe (ej. email duplicado) |

**Ejemplo base — endpoint autenticado simple:**

```python
class OrganizationOut(BaseModel):
    id: str
    name: str
    role: str  # rol del usuario autenticado en esta org


@router.get(
    "/organizations",
    summary="Listar organizaciones del usuario",
    description="""
**¿Qué hace?**
Devuelve todas las organizaciones a las que pertenece el usuario autenticado,
junto con su rol en cada una (`admin` o `member`).

**¿Para qué?**
Permite al frontend mostrar las cuentas disponibles tras el login
para que el usuario seleccione en cuál trabajar.

**¿Dónde se usa?**
Pantalla de selección de organización (post-login).
""",
    response_model=list[OrganizationOut],
    response_description="Lista de organizaciones con rol del usuario en cada una",
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
    },
    tags=["organizations"],
)
def list_organizations(current_user=Depends(get_current_user)):
    ...
```

**Ejemplo con tabla de query params:**

```python
@router.get(
    "/units/{unit_id}/readings",
    summary="Histórico de lecturas de una unidad",
    description="""
**¿Qué hace?**
Devuelve lecturas históricas de sensores de una unidad, filtradas por rango de fechas.

**¿Para qué?**
Alimenta las gráficas temporales del dashboard (temperatura, humedad, luz, CO₂).

**¿Dónde se usa?**
Vista de detalle de unidad — sección de gráficas históricas.

**Parámetros de filtrado:**

| Parámetro | Tipo | Default | Descripción |
|---|---|---|---|
| `from` | ISO 8601 UTC | 24 h atrás | Inicio del rango temporal |
| `to` | ISO 8601 UTC | ahora | Fin del rango temporal |
| `limit` | int | 500 | Máximo de registros devueltos |
""",
    response_model=list[ReadingOut],
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "La unidad no pertenece a la organización del usuario"},
        404: {"description": "Unidad no encontrada"},
    },
    tags=["readings"],
)
def get_readings(unit_id: str, ...):
    ...
```

**Ejemplo con `openapi_extra` — body con variantes:**

```python
@router.post(
    "/units/{unit_id}/commands",
    summary="Enviar comando manual a una unidad",
    description="""
**¿Qué hace?**
Publica un comando al topic MQTT de la unidad y lo registra en la tabla `commands`.

**¿Para qué?**
Permite al operador controlar actuadores manualmente desde el dashboard.

**¿Dónde se usa?**
Panel de control manual en la vista de detalle de unidad.
""",
    response_model=CommandOut,
    responses={
        401: {"description": "Token ausente, inválido o expirado"},
        403: {"description": "La unidad no pertenece a la organización del usuario"},
        404: {"description": "Unidad no encontrada"},
    },
    tags=["commands"],
    openapi_extra={
        "requestBody": {
            "content": {
                "application/json": {
                    "examples": {
                        "pump_on": {
                            "summary": "Encender bomba",
                            "value": {"type": "pump_on"},
                        },
                        "pump_off": {
                            "summary": "Apagar bomba",
                            "value": {"type": "pump_off"},
                        },
                    }
                }
            }
        }
    },
)
def send_command(unit_id: str, command: CommandIn, ...):
    ...
```
