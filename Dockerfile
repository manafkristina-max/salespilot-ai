# SalesPilot AI — образ для публичного демо (Render, Hugging Face Spaces, Koyeb, Fly.io).
# В образе всегда включён публичный демо-режим: внешние сервисы выключены, настройки
# только для просмотра, база во временной папке заполняется демо-данными при старте.
#   docker build -t salespilot . && docker run -p 8000:8000 salespilot

# 1. Интерфейс
FROM node:22-alpine AS ui
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error
COPY frontend/ ./
RUN npm run build

# 2. Harvey (MIT): из submodule, а если его нет в контексте сборки — с GitHub на закреплённом коммите
FROM python:3.13-slim AS harvey
ARG HARVEY_COMMIT=6b6a23a789090e165802baef4104ee4618a3e169
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY vendor/ /src/vendor/
RUN if [ ! -f /src/vendor/harvey/harvey/__init__.py ]; then \
      rm -rf /src/vendor/harvey \
      && git clone -q https://github.com/ethanplusai/harvey.git /src/vendor/harvey \
      && git -C /src/vendor/harvey checkout -q "$HARVEY_COMMIT"; \
    fi

# 3. Приложение
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    SALESPILOT_HOST=0.0.0.0 \
    SALESPILOT_PUBLIC_DEMO=true \
    SALESPILOT_DB=/tmp/salespilot/salespilot.db
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check -r backend/requirements.txt
COPY backend/salespilot backend/salespilot
COPY --from=harvey /src/vendor/harvey/harvey vendor/harvey/harvey
COPY --from=harvey /src/vendor/harvey/LICENSE vendor/harvey/LICENSE
COPY --from=ui /app/frontend/dist frontend/dist
RUN useradd --create-home --uid 10001 app && mkdir -p /tmp/salespilot && chown app /tmp/salespilot
USER app
WORKDIR /app/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % (os.getenv('PORT') or '8000'), timeout=4)"
CMD ["python", "-m", "salespilot"]
