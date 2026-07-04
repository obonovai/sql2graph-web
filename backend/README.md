# sql2graph-web · backend

**FastAPI thin wrapper exposing the [`sql2graph`](https://github.com/obonovai/sql2graph) library to the browser over REST + SSE.**

A small FastAPI app that converts a web request into the library's own config
objects, runs `AsyncSQLTranslator.translate(...)`, and streams the result to the
frontend as Server-Sent Events. It adds no translation logic of its own: it drives
the library's own factories and wiring from an HTTP request instead of local files.

For prerequisites, the run paths, validation modes, and the endpoint table, see the
[top-level README](../README.md) and [`../INSTALL.md`](../INSTALL.md).

## Module map (`app/`)

| Module | Responsibility |
|---|---|
| `main.py` | FastAPI app: logging (silences noisy graph-DB drivers), dev CORS for `:5173`, mounts the API router, and serves the built SPA from `frontend/dist/` when present (same origin). |
| `api.py` | The HTTP surface: `APIRouter(prefix="/api")` with `health`, `options`, `presets`, `validate-mapping`, `build-mapping-stream`, `detect-features`, `check-coverage`, and `translate`. Surfaces config errors as `400` before any stream starts. |
| `bridge.py` | The SSE bridge: turns the library's synchronous callbacks into async SSE generators. See below. |
| `library.py` | The **only** module that touches the library: builds the `SchemaMapping`, model config, and (optional) server config from the request, assembles the translator, and runs the DDL-to-mapping builder. Resolves `server` mode with an empty connection to `managed` (throwaway DB). |
| `models.py` | Pydantic request models: `TranslateRequest`, `LlmSettings`, `ServerSettings`, `ValidationSettings`, plus the smaller bodies `MappingBody`, `SqlBody`, `CoverageBody`, and `BuildMappingBody`. Their shapes mirror `frontend/src/lib/types.ts`. |
| `presets.py` | Reads the library's `examples/` dir for the bundled mapping presets and its `config/` dir for the per-provider model defaults, so the UI's defaults always match the library. |

## The SSE bridge (`bridge.py`)

The library invokes its `on_event` (milestone) and `on_conversation` (transcript)
callbacks **synchronously**, on the same event-loop task that runs `translate()`. The
bridge exposes two async SSE generators built on the same pattern:

- `stream(...)` powers `POST /api/translate`.
- `stream_build_mapping(...)` powers `POST /api/build-mapping-stream`.

Both work as follows:

- **Milestone events** (`generated`, `validated`, `fix`, `stalled`, `max_iterations`,
  `completed`; plus `parse_warning` / `unmapped_tables` / `unmapped_columns`, and a
  synthetic `error`) are pushed onto an `asyncio.Queue` and forwarded immediately. The
  build-mapping stream ends with a single `done` event carrying the generated mapping.
- **Conversation snapshots** fire *per token* and resend the **whole** transcript, so
  they are coalesced: the callback stores the latest snapshot and a timer flushes at
  most one `conversation` event per tick (~12 fps).
- In `managed` mode a `status: provisioning` event is emitted up front while the
  throwaway database boots.
- The translator runs inside `async with`, so on completion **or** client disconnect
  its LLM client, DB connections, and any managed container are torn down (the
  generator's `finally` cancels the task, raising `CancelledError` into `__aexit__`).

This event vocabulary is consumed by the store's SSE reducer in
`frontend/src/hooks/useStore.ts`.

## Run

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

In Docker the backend runs via the top-level `docker-compose.yml`; see
[`../INSTALL.md`](../INSTALL.md) (Path C).

## Configuration

The backend reads these from the process environment (no dotenv loading of its own).

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Read by the Anthropic SDK. |
| `OLLAMA_HOST` | Default Ollama endpoint when the sidebar host override is blank. |
| `SQL2GRAPH_CONFIG_DIR` | Override the library `config/` dir used for model defaults. |
| `SQL2GRAPH_EXAMPLES_DIR` | Override the library `examples/` dir used for preset mappings. |

The two directory defaults resolve to the `../../sql2graph` sibling layout
(`parents[3]/sql2graph/...` relative to `app/presets.py`). When that layout is not
preserved (for example inside a container), set both variables explicitly.

## Checks

```bash
uv run ruff check app
uv run mypy app
```
