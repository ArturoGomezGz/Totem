FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Las migraciones Alembic se aplican antes de levantar la API para que el
# esquema esté siempre al día con el código desplegado.
CMD ["sh", "-c", "alembic upgrade head && python -m uvicorn main:app --host 0.0.0.0 --port 8000"]
