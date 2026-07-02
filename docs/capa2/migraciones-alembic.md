# Migraciones de base de datos con Alembic

**Estado:** adoptado · 2 jul 2026

---

## Qué es

[Alembic](https://alembic.sqlalchemy.org/) es la herramienta de migraciones de base de datos del ecosistema SQLAlchemy (el ORM que ya usa el server). Una *migración* es un script Python versionado en git que describe un cambio de esquema — crear una tabla, agregar una columna, crear un índice — junto con su reverso. Las migraciones forman una cadena ordenada: cada una declara de qué revisión viene (`down_revision`), y Alembic guarda en la tabla `alembic_version` de la base cuál fue la última aplicada.

## Para qué sirve

Antes de Alembic, el esquema vivía en `deploy/db/schema.sql` y solo se ejecutaba al crear el volumen de Docker por primera vez. Cualquier cambio posterior al diseño obligaba a elegir entre dos males: ejecutar `ALTER TABLE` a mano contra cada entorno (propenso a error, sin registro de qué se aplicó dónde) o destruir el volumen y reconstruir el entorno de cero perdiendo todos los datos.

Con Alembic:

- **Cada cambio de esquema es un archivo versionado** en `server/alembic/versions/`, revisable en un PR como cualquier otro código.
- **Los entornos se actualizan solos.** El contenedor `api` ejecuta `alembic upgrade head` antes de levantar uvicorn: al desplegar código nuevo, la base recibe exactamente las migraciones que le faltan — sin SQL manual, sin reconstruir volúmenes, sin perder datos.
- **Todos los entornos convergen al mismo esquema** aunque hayan nacido en momentos distintos, porque Alembic sabe en qué revisión está cada base y aplica solo la diferencia.
- **Los cambios son reversibles**: cada migración define `downgrade()`, útil para deshacer un cambio fallido en desarrollo.

## Cómo está integrado en Totem

| Pieza | Ubicación | Rol |
|---|---|---|
| Configuración | `server/alembic.ini` | Config general. **No contiene la URL de la base** — `env.py` la toma de la variable de entorno `DATABASE_URL`, la misma que usa FastAPI. |
| Entorno de migraciones | `server/alembic/env.py` | Conecta Alembic con `models.py` (via `Base.metadata`) para que `--autogenerate` funcione. |
| Migraciones | `server/alembic/versions/` | Una migración por cambio de esquema. La primera (`306e2ee130d6_schema_inicial`) crea el esquema completo, incluidas las extensiones (`uuid-ossp`, `timescaledb`) y la hypertable `readings`. |
| Ejecución automática | `server/Dockerfile` | `CMD` corre `alembic upgrade head && uvicorn ...` — el esquema siempre está al día con el código desplegado. |
| Seed de desarrollo | `deploy/db/seed.dev.sql` | Datos de prueba (org, admin, sim-001/sim-002). Ya **no** se inyecta automáticamente: se aplica manualmente y solo en desarrollo (ver abajo). |

`deploy/db/schema.sql` fue retirado — su contenido íntegro vive ahora en la migración inicial. La fuente de verdad del esquema es la cadena de migraciones; `docs/capa2/schema.md` sigue siendo la referencia de *diseño* (decisiones, constraints y su porqué).

## Flujo de trabajo

### Cambiar el esquema

1. Editar los modelos en `server/models.py` (agregar columna, tabla, etc.).
2. Generar la migración (desde `server/`, con el venv activo y la base de desarrollo corriendo):

   ```bash
   alembic revision --autogenerate -m "descripcion corta del cambio"
   ```

3. **Revisar el archivo generado** en `alembic/versions/` — autogenerate detecta tablas y columnas, pero **no** detecta CHECK constraints ni conoce los índices parciales y la hypertable que existen solo en SQL; puede proponer eliminarlos por error. Ajustar a mano lo que haga falta (con `op.execute(...)` para SQL específico de PostgreSQL/TimescaleDB).
4. Probarla localmente: `alembic upgrade head`, y verificar el reverso con `alembic downgrade -1` seguido de `alembic upgrade head`.
5. Commit del modelo + la migración juntos, en el mismo PR.

### Comandos frecuentes

```bash
alembic upgrade head        # aplicar todas las migraciones pendientes
alembic downgrade -1        # revertir la última
alembic current             # en qué revisión está la base
alembic history --verbose   # cadena completa de migraciones
```

Todos leen `DATABASE_URL` del entorno (o de `server/.env` en desarrollo local).

### Levantar un entorno de cero

```bash
cd deploy
docker compose up -d --build
```

El contenedor `api` aplica las migraciones al arrancar — no hay que ejecutar ningún SQL. Para cargar los datos de prueba de desarrollo (opcional):

```bash
docker compose exec -T db psql -U $POSTGRES_USER -d $POSTGRES_DB < db/seed.dev.sql
```

### Migrar un entorno existente (pre-Alembic)

Los entornos creados con el antiguo `schema.sql` no tienen la tabla `alembic_version`, así que `alembic upgrade head` intentaría crear tablas que ya existen. Para esta iteración la decisión fue **reconstruirlos de cero** (`docker compose down -v && docker compose up -d --build`), asumiendo la pérdida de datos. A partir de ahí, ningún cambio de esquema vuelve a requerir reconstrucción.

## Reglas

- **Nunca ejecutar DDL a mano** contra una base gestionada por Alembic — el esquema real divergiría de lo que las migraciones creen que existe, y la siguiente migración puede fallar de formas difíciles de diagnosticar.
- **Nunca editar una migración ya aplicada en otro entorno** (ya pusheada) — crear una nueva que corrija. Editar una migración solo es aceptable mientras vive únicamente en tu rama.
- **Modelo y migración viajan juntos** en el mismo commit/PR: si `models.py` cambia sin migración, los entornos desplegados quedan con un esquema que no corresponde al código.
