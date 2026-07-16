# Install and run

**Set up the web UI for local development, as a production build, or with Docker.**

## Scope

This page owns: prerequisites, the sibling-clone repository layout, the three
run paths (manual development, production build, Docker), the throwaway-database
overlay, the environment-variable table, the check and build commands, and
troubleshooting. Related topics live with their owners:

- [architecture.md](architecture.md): the mental model; the one-origin topology
  these run paths produce.
- [api.md](api.md): the REST and SSE endpoints once the app is running.
- [../README.md](../README.md): the project overview; [README.md](README.md):
  the full doc map.

---

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| `git` | any | Cloning both repos. |
| [`uv`](https://docs.astral.sh/uv/) | recent | The backend (creates the venv, installs the library editable). |
| Node.js | 22 (or 20.19+/22.12+) | The frontend (Vite 8 requires a modern Node). |
| Docker + Compose | Engine + Compose v2.17+ | Only for the Docker path (`additional_contexts` needs Compose v2.17+). |

The backend targets Python `>=3.12`; `uv` fetches a matching interpreter for you.
You do not need `pip` or a manual `virtualenv`.

## Repository layout (clone both repos as siblings)

`sql2graph-web` is a thin browser front end over the
[`sql2graph`](https://github.com/obonovai/sql2graph) library. The two live in
separate repositories that must be cloned side by side: the backend installs the
library from the sibling directory and reads its `config/` and `examples/` at
runtime, and the built SPA is served by the backend from one origin.

Clone the library and the web UI into the **same parent directory**, and keep the
library directory named exactly `sql2graph`:

```
<parent>/                # any directory; NOT itself a git repo
  sql2graph/             # the library repo; the directory MUST be named sql2graph
  sql2graph-web/         # this repo
```

```bash
# from the parent directory
git clone https://github.com/obonovai/sql2graph.git      sql2graph
git clone https://github.com/obonovai/sql2graph-web.git  sql2graph-web
```

This layout is not optional. Three fixed paths depend on it:

- `backend/pyproject.toml:23-24` installs the library from `../../sql2graph`
  (`[tool.uv.sources]`), so `uv sync` fails if the sibling is missing or renamed.
- `backend/app/presets.py:37` and `backend/app/presets.py:45` resolve the library
  `config/` and `examples/` dirs as `parents[3]/sql2graph/...` (overridable with
  `SQL2GRAPH_CONFIG_DIR` / `SQL2GRAPH_EXAMPLES_DIR`).
- `backend/app/main.py:31-33` mounts the built SPA from `parents[2]/frontend/dist`.

Renaming or nesting the library directory breaks `import sql2graph` and the preset
mappings. See [Troubleshooting](#troubleshooting).

## Path A: manual development (two terminals)

Runs the backend and the Vite dev server separately; the dev server proxies `/api`
to the backend and gives you hot reload on both sides.

```bash
# Terminal 1: backend on :8000
export ANTHROPIC_API_KEY=...        # and/or export OLLAMA_HOST=...
cd sql2graph-web/backend
uv sync                             # creates the venv, installs ../../sql2graph editable
uv run uvicorn app.main:app --reload --port 8000
```

```bash
# Terminal 2: frontend on :5173 (proxies /api -> :8000)
cd sql2graph-web/frontend
npm install
npm run dev
```

Open http://localhost:5173. Start the backend first: the dev server needs it on
`:8000` for `/api` calls to succeed. Ready-made sample mappings live in
`sql2graph/examples/mappings/`.

## Path B: production build (single origin)

Build the SPA to static files, then let the backend serve it. No dev server, no
CORS, one origin.

```bash
cd sql2graph-web/frontend && npm run build        # emits frontend/dist/
cd ../backend && uv run uvicorn app.main:app --port 8000
```

Open http://localhost:8000. When `frontend/dist/` exists, `main.py` mounts it at
`/`, so the SPA and the `/api` routes share the origin.

## Path C: Docker (single container)

The same single-origin model as Path B, packaged as one image. A multi-stage build
compiles the SPA, installs the library as a wheel, and runs `uvicorn`; the sibling
library repo is pulled in as the `library` build context (`../sql2graph`).

```bash
cd sql2graph-web
cp .env.example .env                # then fill in ANTHROPIC_API_KEY and/or OLLAMA_HOST

# Standard (non-root, no host Docker access):
docker compose up --build

# Or, to also allow empty-config `server` validation to auto-provision throwaway
# databases (docker-out-of-docker; the app runs as root, local development only):
docker compose -f docker-compose.yml -f docker-compose.docker-socket.yml up --build
```

Open http://localhost:8000. Notes:

- Run `docker compose` from `sql2graph-web/` with the `../sql2graph` sibling present.
- The container reports health via `GET /api/health`.
- Secrets are injected at runtime from `.env`; nothing is baked into the image.
- To use an Ollama server running on your host machine, set
  `OLLAMA_HOST=http://host.docker.internal:11434` in `.env` (on Linux, also
  uncomment the `extra_hosts` line in `docker-compose.yml`).
- `server`-mode validation with an empty connection auto-provisions a throwaway
  database via testcontainers, which needs a Docker daemon reachable from the
  backend. In Docker you have two options: enter an explicit connection to a running
  database (a database on your Mac is reached via `host.docker.internal`), or enable
  the docker-socket overlay below to let the backend provision throwaway databases.

## Throwaway databases (empty-config `server` validation)

Picking `server` validation and leaving the connection blank makes the library
auto-provision a disposable Neo4j / ArangoDB / Gremlin via testcontainers. That needs
a Docker daemon reachable from the backend; inside the container there is none by
default, so the UI reports *"Empty config needs Docker on the backend; none detected"*
and blocks it.

The `docker-compose.docker-socket.yml` overlay grants the container access to the host
Docker daemon (docker-out-of-docker) so this works. Enable it with two `-f` flags:

```bash
docker compose -f docker-compose.yml -f docker-compose.docker-socket.yml up -d
```

Then select `server`, leave the connection blank, and translate; the first run pulls
the database image and boots it (10 to 40 seconds). The overlay runs the app as
**root**, mounts `/var/run/docker.sock`, and sets
`TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal` so the app container can reach
the throwaway database's published port on the host. Use it for **local development
only**: for a shared or production deployment, provide an explicit connection to a
real database instead. Return to the plain, non-root app with `docker compose up -d`.

## Environment variables and secrets

| Variable | Used by | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic SDK on the backend | Never entered in the browser. |
| `OLLAMA_HOST` | Backend | Default Ollama endpoint when the sidebar host override is blank. |
| `SQL2GRAPH_CONFIG_DIR` | Backend | Override the library `config/` dir used for model-field defaults. Defaults to the sibling `../sql2graph/config`. |
| `SQL2GRAPH_EXAMPLES_DIR` | Backend | Override the library `examples/` dir used for preset mappings. Defaults to the sibling `../sql2graph/examples`. |

The two directory defaults resolve to the `../../sql2graph` sibling layout
(`parents[3]/sql2graph/...` relative to `app/presets.py`; see
`backend/app/presets.py:37` and `backend/app/presets.py:45`). When that layout is
not preserved (for example inside a container), set both variables explicitly.

The backend reads these from the process environment; it does not load a `.env`
file itself. In development, `export` them (Path A) or `source` your own env file
before starting uvicorn. Under Docker, Compose loads `sql2graph-web/.env` and passes
the values in.

Never commit a real `.env`. This repo's `.gitignore` ignores `.env` / `.env.*` (but
keeps `.env.example`). The library repo keeps its own separate `.env` with real
secrets; it is used only when running the library directly and is not consumed by
this app.

## Checks and builds

Backend lint and type checks, from `backend/` after `uv sync`:

```bash
uv run ruff check app
uv run mypy app
```

Frontend develop and build, from `frontend/` after `npm install`:

```bash
npm run dev      # http://localhost:5173, proxies /api -> http://localhost:8000
npm run build    # tsc --noEmit && vite build -> dist/  (served by the backend in prod / Docker)
```

`npm run dev` needs the backend already running on `:8000` for the `/api` proxy
calls to succeed.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `uv sync` fails / `ModuleNotFoundError: sql2graph` | The library is not a sibling named `sql2graph`. | Clone it as `<parent>/sql2graph` (see [layout](#repository-layout-clone-both-repos-as-siblings)). |
| `/api/options` or `/api/presets` returns empty defaults | `SQL2GRAPH_CONFIG_DIR` / `SQL2GRAPH_EXAMPLES_DIR` don't resolve. | Keep the sibling layout, or set the two vars explicitly. |
| Blank page / SPA 404 in production | No build at `parents[2]/frontend/dist`. | Run `npm run build`; in Docker confirm `dist` landed at `/app/sql2graph-web/frontend/dist`. |
| Docker: "context escapes" / library not found | Compose run from the wrong dir, or the sibling is missing. | Run `docker compose up --build` from `sql2graph-web/` with `../sql2graph` present. |
| Ollama unreachable from the container | `localhost` inside the container is the container itself. | Use `OLLAMA_HOST=http://host.docker.internal:11434` (or an `ollama` service). |
| `server` validation blocked ("needs Docker on the backend; none detected") | No Docker daemon reachable from the backend (e.g. inside the container). | Enter an explicit connection to a running database, or enable the [docker-socket overlay](#throwaway-databases-empty-config-server-validation). |
