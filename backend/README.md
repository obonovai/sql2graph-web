# rows2graph-web · backend

A small FastAPI app that exposes the [`rows2graph`](../../rows2graph) library to the
browser. It is a **thin wrapper**: it converts the web request into the library's
own config objects, runs `AsyncSQLTranslator.translate(...)`, and streams the
result to the frontend as Server-Sent Events. It adds no translation logic of its
own: the same wiring `rows2graph/demo/cli.py` uses, driven by an HTTP request
instead of argparse + files.

For prerequisites, running, validation modes, configuration, and the endpoint
table, see the [top-level README](../README.md).

## Module map (`app/`)

| Module | Responsibility |
|---|---|
| `main.py` | FastAPI app: logging (silences noisy graph-DB drivers), dev CORS for `:5173`, mounts the API router, and serves the built SPA from `frontend/dist/` when present (same origin). |
| `api.py` | The HTTP surface: `APIRouter(prefix="/api")` with the `health` / `options` / `presets` / `validate-mapping` / `detect-features` / `translate` routes. Surfaces config errors as `400` before any stream starts. |
| `bridge.py` | The SSE bridge: see below. |
| `library.py` | The **only** module that touches the library: builds the `SchemaMapping`, model config, and (optional) server config from the request, and assembles the translator. Resolves `server` mode with an empty connection to `managed` (throwaway DB). |
| `models.py` | Pydantic request models (`TranslateRequest`, `LlmSettings`, `ServerSettings`, `ValidationSettings`, …). Their shapes mirror `frontend/src/lib/types.ts`. |
| `presets.py` | Reads the library's `config/` dir for the bundled mapping presets and the per-provider model defaults, so the UI's defaults always match the library. |

## The SSE bridge (`bridge.py`)

The library invokes its `on_event` (milestone) and `on_conversation` (transcript)
callbacks **synchronously**, on the same event-loop task that runs `translate()`.
`stream()` turns those into an async SSE generator:

- **Milestone events** (`generated`, `validated`, `fix`, `stalled`,
  `max_iterations`, `completed`, plus a synthetic `error`) are pushed onto an
  `asyncio.Queue` and forwarded immediately.
- **Conversation snapshots** fire *per token* and resend the **whole** transcript,
  so they're coalesced: the callback stores the latest snapshot and a timer flushes
  at most one `conversation` event per tick (~12 fps).
- In `managed` mode a `status: provisioning` event is emitted up front while the
  throwaway database boots.
- The translator runs inside `async with`, so on completion **or** client
  disconnect its LLM client, DB connections, and any managed container are torn
  down (the generator's `finally` cancels the task → `CancelledError` →
  `__aexit__`).

This event vocabulary is consumed by the store's SSE reducer in
`frontend/src/hooks/useStore.ts`.

## Run

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Env: `ANTHROPIC_API_KEY` (Anthropic), `OLLAMA_HOST` (default Ollama endpoint),
`ROWS2GRAPH_CONFIG_DIR` (override the library `config/` dir; defaults to
`../rows2graph/config`).

## Checks

```bash
uv run ruff check app
uv run mypy app        # if configured
```
