# sql2graph-web

**Browser UI over the [`sql2graph`](https://github.com/obonovai/sql2graph) library: translate SQL into Cypher / AQL / Gremlin, no Python required.**

A simple, hand-owned web front end for the `sql2graph` translator. It is a thin
wrapper: the backend calls the public `sql2graph` library API and adds no
translation logic of its own. In production the backend also serves the built
single-page app, so the whole thing runs on one origin.

```
┌Settings──┐ ┌ Header:  sql2graph · model · ☾ ──────────────────┐ ┌Chat──────┐
│ LLM      │ │ Run setup:  Target ▾       [▸ Translate] [Clear] │ │ system ↔ │
│ Valid.   │ │ ┌ Mapping │ SQL ┐    ║    ┌ Result ───────────┐  │ │ LLM      │
│ (server) │ │ │  editor…      │    ║    │  generated query… │  │ │ stream   │
│          │ │ └ ✓ 7 nodes·8 e ┘    ║    └ ✓ success · 2 it… ┘  │ │          │
└──────────┘ └──────────────────────────────────────────────────┘ └──────────┘
        (║ = the draggable divider between the Inputs and Result panes)
```

## Architecture

- **Backend** (`backend/`, FastAPI): builds the library's own config objects from the
  request, runs `AsyncSQLTranslator.translate(...)`, and bridges its `on_conversation`
  and `on_event` callbacks to **Server-Sent Events** via an `asyncio.Queue`.
  Conversation snapshots (which fire per token and resend the whole transcript) are
  coalesced to ~12 fps; the translator runs inside `async with` so the LLM client, DB
  connections, and any throwaway managed DB are torn down on completion or client
  disconnect. See [`backend/README.md`](backend/README.md).
- **Frontend** (`frontend/`, Vite + React + TypeScript): a three-column shell, with a
  collapsible Settings sidebar, a center workbench, and a collapsible live Chat
  sidebar. The center stacks a header, a run-setup bar (target + Translate), and a
  resizable Inputs / Result split: the inputs pane carries the schema mapping (YAML)
  and SQL as co-equal tabs, the result pane shows the generated query plus the run
  outcome. The API base is a hardcoded relative `/api`, so production must be
  same-origin (Vite proxies it in development). See
  [`frontend/README.md`](frontend/README.md).

## Prerequisites

- The `sql2graph` library, cloned as a **sibling directory** named `sql2graph` (the
  backend installs it editable from `../../sql2graph`). See [`INSTALL.md`](INSTALL.md).
- Python `>=3.12` and [`uv`](https://docs.astral.sh/uv/) for the backend.
- Node.js 22 (Vite 8 requires 20.19+/22.12+) for the frontend.
- An LLM backend:
  - **Anthropic**: export `ANTHROPIC_API_KEY` for the backend (never entered in the
    browser).
  - **Ollama**: running locally or via `OLLAMA_HOST`; pull the model you select.
- **Docker** (optional): for the containerized run, or for `server` validation with an
  empty connection (auto-provisions a throwaway Neo4j / ArangoDB / Gremlin via
  testcontainers).

## Quick start (development)

Two terminals; full detail in [`INSTALL.md`](INSTALL.md) (Path A).

```bash
# 1) backend on :8000  (export ANTHROPIC_API_KEY and/or OLLAMA_HOST first)
cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000

# 2) frontend on :5173 (proxies /api -> :8000)
cd frontend && npm install && npm run dev
```

Open http://localhost:5173. Paste or upload a schema mapping (YAML) and a SQL query,
pick a target, and click **Translate**. Sample mappings live in
`sql2graph/examples/mappings/`.

## Build (production)

```bash
cd frontend && npm run build      # emits frontend/dist/
cd ../backend && uv run uvicorn app.main:app --port 8000
```

When `frontend/dist/` exists the backend serves the SPA from `/` (same origin, no
CORS). Open http://localhost:8000. See [`INSTALL.md`](INSTALL.md) (Path B).

## Docker

A single-container build serves the SPA and the API on one origin. The sibling
`sql2graph` repo is pulled in as a named build context, so both repos must be cloned
side by side (see [`INSTALL.md`](INSTALL.md), Path C).

```bash
cp .env.example .env              # then fill in ANTHROPIC_API_KEY and/or OLLAMA_HOST
docker compose up --build
```

Open http://localhost:8000. Secrets are injected at runtime from `.env` (never baked
into the image), and the container reports health via `GET /api/health`.

## Validation modes

- `none`: single shot, no checks.
- `syntax`: fast offline grammar checks, no database.
- `server`: validate each candidate against a graph DB. Fill in the connection to use
  **your** database, or leave it empty to auto-provision a **throwaway** one via
  Docker (`managed`). The DB is reached from the **backend** host, so "localhost"
  means the server's localhost. The throwaway path needs a Docker daemon reachable
  from the backend; in the single-container Docker deployment, enable it with the
  `docker-compose.docker-socket.yml` overlay (see [`INSTALL.md`](INSTALL.md)), or
  enter an explicit connection instead.

## Configuration

The backend reads these from the process environment (it does not load a `.env` file
itself; under Docker, Compose passes them in).

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Read by the Anthropic SDK on the backend. |
| `OLLAMA_HOST` | Default Ollama endpoint when the sidebar host override is blank. |
| `SQL2GRAPH_CONFIG_DIR` | Override the library `config/` dir used for model-field defaults. Defaults to the sibling `../sql2graph/config`. |
| `SQL2GRAPH_EXAMPLES_DIR` | Override the library `examples/` dir used for preset mappings. Defaults to the sibling `../sql2graph/examples`. |

## API

All routes are served under the `/api` prefix. The two SSE endpoints surface invalid
config as HTTP 400 before the stream opens.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness probe (`{"status": "ok"}`). |
| GET | `/api/options` | Enums, library defaults, per-target valid modes, server-config defaults, and throwaway-DB availability, for building the forms. |
| GET | `/api/presets` | Bundled tpch/ldbc mappings + sample SQL (backend only; the current UI does not auto-load them). |
| POST | `/api/validate-mapping` | Validate a mapping YAML string; returns `{valid, errors, node_count, edge_count, graph}`. |
| POST | `/api/build-mapping-stream` | SSE: stream the LLM naming conversation, then a `done` event carrying a schema mapping built from `CREATE TABLE` DDL. |
| POST | `/api/detect-features` | The SQL features the translator detects, plus `parse_ok` (drives the feature chips). |
| POST | `/api/check-coverage` | Live pre-flight: SQL tables/columns absent from the mapping (`unmapped_tables`, `unmapped_columns`, `parse_ok`). |
| POST | `/api/translate` | SSE stream of the run: `status`, `conversation`, `generated`, `validated`, `fix`, `stalled`, `max_iterations`, `completed`, plus `parse_warning` / `unmapped_tables` / `unmapped_columns` and a synthetic `error`. |

## Documentation

| Document | Contents |
|---|---|
| [`INSTALL.md`](INSTALL.md) | Prerequisites, sibling-clone layout, and the manual / production / Docker run paths. |
| [`backend/README.md`](backend/README.md) | The FastAPI app: module map, the SSE bridge, and configuration. |
| [`frontend/README.md`](frontend/README.md) | The SPA: tech stack, structure, state model, and conventions. |
| [`obonovai/sql2graph`](https://github.com/obonovai/sql2graph) | The underlying library (cloned as the sibling `../sql2graph` on disk). |

## License

Released under the MIT License. See [`LICENSE`](LICENSE).
