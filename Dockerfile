# syntax=docker/dockerfile:1.7
#
# Single-image build for sql2graph-web: the FastAPI backend serves the built
# React SPA and the /api routes from one origin (port 8000). The sql2graph
# library lives in a SEPARATE sibling repo, so it is pulled in as a named build
# context ("library") rather than from the primary context. Build via the
# accompanying docker-compose.yml (which wires that context to ../sql2graph):
#
#     docker compose up --build
#
# The in-image layout deliberately mirrors the on-disk sibling layout so the
# backend's hardcoded relative paths resolve unchanged:
#   /app/sql2graph/               vendored library config/ + examples/ (runtime data)
#   /app/sql2graph-web/backend/   backend app/ + the resolved venv (uvicorn CWD)
#   /app/sql2graph-web/frontend/dist/   built SPA (main.py mounts parents[2]/frontend/dist)

########## Stage 1: build the SPA ##########
FROM node:22-bookworm-slim AS frontend
WORKDIR /build
# Install against the committed lockfile first, for layer caching.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
# Then the sources + build. .dockerignore keeps node_modules/dist out of the
# context, so this COPY can't clobber the freshly installed modules.
COPY frontend/ ./
RUN npm run build            # -> /build/dist

########## Stage 2: resolve the Python environment ##########
FROM python:3.12-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

# Vendor ONLY the files hatchling needs to build the library wheel. NEVER
# "COPY --from=library . ": the library repo root holds a real-secret .env and a
# host .venv. pyproject declares readme = README.md and license-files = [LICENSE],
# so both are required inputs alongside src/.
COPY --from=library pyproject.toml README.md LICENSE /app/sql2graph/
COPY --from=library src /app/sql2graph/src

# backend/pyproject.toml resolves the library from ../../sql2graph, which is
# /app/sql2graph in this layout. --no-editable installs it as a built wheel, so
# the runtime venv is self-contained (no library src needed at runtime; only its
# config/ + examples/ data files, copied in the runtime stage).
WORKDIR /app/sql2graph-web/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

########## Stage 3: runtime ##########
FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONUNBUFFERED=1 \
    PATH="/app/sql2graph-web/backend/.venv/bin:$PATH" \
    SQL2GRAPH_CONFIG_DIR=/app/sql2graph/config \
    SQL2GRAPH_EXAMPLES_DIR=/app/sql2graph/examples

# The self-contained venv (the library is baked in as a wheel).
COPY --from=builder /app/sql2graph-web/backend/.venv /app/sql2graph-web/backend/.venv
# Backend app code (package = false: uvicorn runs it from CWD, never installed).
COPY backend/app /app/sql2graph-web/backend/app
# The library data files presets.py reads at runtime (src/ is unneeded here).
COPY --from=library config   /app/sql2graph/config
COPY --from=library examples /app/sql2graph/examples
# The SPA must land at parents[2]/frontend/dist of backend/app/main.py.
COPY --from=frontend /build/dist /app/sql2graph-web/frontend/dist

# Run as a non-root user.
RUN useradd --system --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser

WORKDIR /app/sql2graph-web/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
