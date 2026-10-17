# AquaSmart - imagem do back-end (Flask) que também serve o front-end (pasta frontend/)
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app/backend

COPY backend/requirements.txt .
RUN pip install -r requirements.txt "gunicorn>=22,<24"

COPY backend/ /app/backend/
COPY frontend/ /app/frontend/
COPY database/ /app/database/
RUN sed -i "s/\r$//" /app/backend/docker-entrypoint.sh && chmod +x /app/backend/docker-entrypoint.sh

EXPOSE 5000
ENTRYPOINT ["/app/backend/docker-entrypoint.sh"]
