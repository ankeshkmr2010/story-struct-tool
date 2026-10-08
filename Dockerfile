FROM node:24-bookworm-slim AS frontend
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS app
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app/api
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 PATH="/app/api/.venv/bin:$PATH" \
    STORYTOOL_DEBUG=false STORYTOOL_FRONTEND_DIR=/app/web/dist
COPY api/pyproject.toml api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY api/src ./src
COPY api/alembic.ini ./
RUN uv sync --frozen --no-dev
COPY --from=frontend /build/web/dist /app/web/dist
COPY scripts/start-production.sh /app/start-production.sh
RUN useradd --create-home --uid 10001 storytool && chown -R storytool:storytool /app
USER storytool
EXPOSE 8000
CMD ["sh", "/app/start-production.sh"]
