# sql2graph-web

A simple, hand-owned web UI that wraps the [`sql2graph`](../sql2graph) library: translate
SQL into Cypher / AQL / Gremlin through a browser, no Python required. It is a thin wrapper: the
backend calls the public `sql2graph` library API and adds no
translation logic of its own.

```
┌Settings──┐ ┌ Header:  sql2graph · model · ☾ ────────────────┐ ┌Chat──────┐
│ LLM      │ │ Run setup:  Target ▾       [▸ Translate] [Clear] │ │ system ↔ │
│ Valid.   │ │ ┌ Mapping │ SQL ┐    ║    ┌ Result ───────────┐  │ │ LLM      │
│ (server) │ │ │  editor…       │    ║    │  generated query… │  │ │ stream   │
│          │ │ └ ✓ 7 nodes·8 e  ┘    ║    └ ✓ success · 2 it… ┘  │ │          │
└──────────┘ └──────────────────────────────────────────────────┘ └──────────┘
        (║ = the draggable divider between the Inputs and Result panes)
```

## Architecture

- **Backend** (`backend/`, FastAPI): builds the library's own config objects from the request,
  runs `AsyncSQLTranslator.translate(...)`, and bridges its `on_conversation` / `on_event`
  callbacks to **Server-Sent Events** via an `asyncio.Queue`. Conversation snapshots (which fire
  per token and resend the whole transcript) are coalesced to ~12 fps; the translator runs inside
  `async with` so the LLM client, DB connections, and any throwaway managed DB are torn down on
  completion or client disconnect. See **[`backend/README.md`](backend/README.md)**.
- **Frontend** (`frontend/`, Vite + React + TS): a three-column shell, collapsible Settings
  sidebar · center workbench · collapsible live Chat sidebar. The center stacks a Header, a
  Run-setup bar (target + Translate), and a resizable **Inputs ∥ Result** split: the inputs pane
  carries the schema mapping (YAML) and SQL as co-equal tabs, the result pane shows the generated
  query plus the run outcome. Zustand store, Tailwind, CodeMirror, `react-resizable-panels`, and
  `@microsoft/fetch-event-source` for the SSE stream. See **[`frontend/README.md`](frontend/README.md)**.

## Prerequisites

- The `sql2graph` library sibling repo (this app installs it editable from `../sql2graph`).
- An LLM backend:
  - **Anthropic**: export `ANTHROPIC_API_KEY` for the backend (the key is never entered in the
    browser).
  - **Ollama**: running locally or via `OLLAMA_HOST` (e.g. an SSH tunnel); pull the model you select.
- **Docker** (optional): only for `server` validation with an empty connection (auto-provisions a
  throwaway Neo4j / ArangoDB / Gremlin via testcontainers).

## Run (development)

Two terminals:

```bash
# 1) backend on :8000  (export ANTHROPIC_API_KEY and/or OLLAMA_HOST first)
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000

# 2) frontend on :5173 (proxies /api -> :8000)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Paste or **upload** a schema mapping (YAML) and a SQL query, pick a
target, and click **Translate**. (Ready-made sample mappings live in `sql2graph/examples/mappings/`.)

## Build (production)

```bash
cd frontend && npm run build      # emits frontend/dist/
cd ../backend && uv run uvicorn app.main:app --port 8000
```

When `frontend/dist/` exists the backend serves the SPA from `/` (same origin, no CORS).

## Validation modes

- `none`: single shot, no checks.
- `syntax`: fast regex sanity checks, no database.
- `server`: validate each candidate against a graph DB. Fill in the connection to use **your**
  database, or leave it empty to auto-provision a **throwaway** one via Docker. The DB is reached
  from the **backend** host: "localhost" means the server's localhost.

## Configuration

- `OLLAMA_HOST`: default Ollama endpoint when the sidebar host override is blank.
- `ANTHROPIC_API_KEY`: read by the Anthropic SDK on the backend.
- `SQL2GRAPH_CONFIG_DIR`: override the library `config/` dir used for the model-field
  defaults (`models/`); defaults to `../sql2graph/config`.
- `SQL2GRAPH_EXAMPLES_DIR`: override the library `examples/` dir used for the preset
  mappings (`mappings/`); defaults to `../sql2graph/examples`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness. |
| GET | `/api/options` | Enums + library defaults + Docker availability for the forms. |
| GET | `/api/presets` | Bundled tpch/ldbc mappings + sample SQL (backend only: the current UI doesn't auto-load them). |
| POST | `/api/validate-mapping` | Validate a mapping YAML string (`{valid, errors, node_count, edge_count}`). |
| POST | `/api/detect-features` | The SQL features the translator detects (for the chips). |
| POST | `/api/translate` | SSE stream: `status`/`conversation`/`generated`/`validated`/`fix`/`max_iterations`/`completed`/`error`. |
