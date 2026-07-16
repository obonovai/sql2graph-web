# Architecture

**The mental model of `sql2graph-web`: one origin, a thin FastAPI bridge over
the sibling `sql2graph` library, and a single Zustand store driving the UI.**

## Scope

This page owns: the one-origin topology, the coupling to the sibling library
repo, the module maps on both sides of the stack, and the end-to-end anatomy
of a translate run. Related topics live with their owners:

- [install.md](install.md): setup, the three run paths, environment variables.
- [api.md](api.md): the REST endpoint reference.
- [streaming.md](streaming.md): the SSE lifecycle end to end, bridge
  coalescing to store reducer.
- [state.md](state.md): the frontend state model, the Zustand store.
- [frontend.md](frontend.md): SPA structure and conventions.
- [../README.md](../README.md): quick start; [README.md](README.md): the full
  doc map.

---

## The one-origin model

The frontend hardcodes a relative `/api` base: every REST helper and both SSE
streams fetch paths like `/api/options` and `/api/translate` with no
configurable host (`frontend/src/lib/api.ts:19`,
`frontend/src/lib/api.ts:123`). The browser therefore always talks to the
origin that served the page, and each run path arranges for the API to live
there:

| Run path | Origin the browser sees | How `/api` reaches FastAPI | Detail |
|---|---|---|---|
| Development | `http://localhost:5173` (Vite dev server) | Vite proxies `/api` to `http://localhost:8000`; SSE streams straight through (`frontend/vite.config.ts:13-21`) | [install.md](install.md), Path A |
| Production build | `http://localhost:8000` (FastAPI) | Same process: when `frontend/dist/` exists, `main.py` mounts it at `/` next to the `/api` router (`backend/app/main.py:31-33`) | [install.md](install.md), Path B |
| Docker | `http://localhost:8000` (one container) | Same as the production build, packaged as a single multi-stage image | [install.md](install.md), Path C |

The payoff is that production has no CORS at all: the SPA and the API share
one origin, so no cross-origin machinery and no deploy-time API URL to
configure. The backend's CORS middleware exists only for the development
split, allowlisting the Vite ports (`backend/app/main.py:21-26`).

---

## Sibling-repo coupling

The web app assumes the library repo is cloned as a sibling directory named
`sql2graph`. Two fixed paths encode that assumption:

- **The editable install.** `[tool.uv.sources]` pins the `sql2graph`
  dependency to `../../sql2graph` as an editable install
  (`backend/pyproject.toml:23-24`), so the backend imports the library exactly
  as a third-party user would, against the sibling working tree
  (`../sql2graph/src/sql2graph/`).
- **Presets and defaults.** `_config_dir` and `_examples_dir` resolve to
  `parents[3] / "sql2graph" / config` and `.../examples` unless
  `SQL2GRAPH_CONFIG_DIR` / `SQL2GRAPH_EXAMPLES_DIR` override them
  (`backend/app/presets.py:32-45`). Mapping presets come from
  `../sql2graph/examples/mappings/`, the sidebar's model-field defaults from
  `../sql2graph/config/models/`, so editing the library's files is the single
  source of truth for the UI's defaults.

The clone layout, and what to set when it is not preserved (for example
inside a container), are in [install.md](install.md).

---

## Backend module map

Six modules under `backend/app/`; the app adds no translation logic of its
own.

| Module | Responsibility |
|---|---|
| `main.py` | FastAPI app: logging (silences noisy graph-DB drivers), dev CORS for `:5173`, mounts the API router, and serves the built SPA from `frontend/dist/` when present (same origin). |
| `api.py` | The HTTP surface: `APIRouter(prefix="/api")` with `health`, `options`, `presets`, `validate-mapping`, `build-mapping-stream`, `detect-features`, `check-coverage`, and `translate`. Surfaces config errors as `400` before any stream starts. |
| `bridge.py` | The SSE bridge: turns the library's synchronous callbacks into async SSE generators. Detailed in [streaming.md](streaming.md). |
| `library.py` | The **only** module that touches the library: builds the `SchemaMapping`, model config, and (optional) server config from the request, assembles the translator, and runs the DDL-to-mapping builder. Resolves `server` mode with an empty connection to `managed` (throwaway DB). |
| `models.py` | Pydantic request models: `TranslateRequest`, `LlmSettings`, `ServerSettings`, `ValidationSettings`, plus the smaller bodies `MappingBody`, `SqlBody`, `CoverageBody`, and `BuildMappingBody`. Their shapes mirror `frontend/src/lib/types.ts`. |
| `presets.py` | Reads the library's `examples/` dir for the bundled mapping presets and its `config/` dir for the per-provider model defaults, so the UI's defaults always match the library. |

The endpoints themselves are specified in [api.md](api.md); the
`models.py` / `types.ts` mirror contract is in [types.md](types.md).

---

## Frontend at a glance

The organizing idea is a **logic vs. visual** split: `lib/` and `hooks/` hold
`.ts` logic and state, `components/ui/` holds store-free presentational
`.tsx`, and the remaining `components/*` are the store-connected feature
components.

| Directory | Role | Holds |
|---|---|---|
| `frontend/src/lib/` | Framework-agnostic logic and types | `api.ts` (typed backend client: REST plus the two SSE streams), `types.ts` (the backend type mirror, [types.md](types.md)), `diff.ts` |
| `frontend/src/hooks/` | State and effects | `useStore.ts` (the Zustand store, [state.md](state.md)) plus four debounced hooks for mapping validation, feature detection, and coverage |
| `frontend/src/components/ui/` | Store-free design-system pieces | `primitives.tsx`, `CodeEditor.tsx`, `Sidebar.tsx` |
| `frontend/src/components/` | Store-connected feature components | Header, workspace bar, the mapping and SQL panels, chat sidebar, settings forms |

The per-file table and the layout conventions are in
[frontend.md](frontend.md).

---

## Anatomy of a translate run

One click on Translate exercises every layer of the stack, in order:

1. **Form state.** Everything the user configures (target, LLM settings,
   validation settings, the SQL, the active mapping YAML) lives in the
   store's `form` slice. The `translate()` action first gates on
   `canTranslate()` (no run in flight, non-empty SQL, valid mapping, no
   reject-level pre-flight signals; `frontend/src/hooks/useStore.ts:445-461`),
   then `buildRequest` shapes the form into a `TranslateRequest`
   (`frontend/src/hooks/useStore.ts:276-308`). See [state.md](state.md).
2. **POST `/api/translate`.** `translateStream` opens the SSE stream with
   `fetchEventSource`, carrying an `AbortController` signal so the Stop
   button can cancel it (`frontend/src/lib/api.ts:114-159`). A non-stream
   response (an HTTP 400 with a JSON `detail`) is surfaced as an error
   instead of a stream. See [api.md](api.md).
3. **The handler.** `translate` (`backend/app/api.py:229-239`) rejects empty
   SQL and converts any config error raised while building the translator
   into that HTTP 400, so only a buildable run ever starts streaming.
4. **Translator assembly.** `library.build_translator`
   (`backend/app/library.py:169-201`) parses the mapping
   (`SchemaMapping.from_yaml_string`), builds the model config and optional
   server config, resolves `server` mode with an empty connection to
   `managed`, and wires an `AsyncSQLTranslator` through the library's own
   factories (`make_async_llm`, `make_target`, `make_async_validator`).
5. **The bridge.** `stream` (`backend/app/bridge.py:84-138`) runs the
   translator inside `async with` (teardown on completion or client
   disconnect) and registers two callbacks: milestone events go straight
   onto an `asyncio.Queue`; per-token conversation snapshots are coalesced
   to at most one flush per tick (`_COALESCE_SECONDS = 0.08`, about 12 fps;
   `backend/app/bridge.py:52`). In `managed` mode a `status: provisioning`
   event precedes everything while the throwaway DB boots. See
   [streaming.md](streaming.md).
6. **Events over the wire.** `_event_to_sse` (`backend/app/bridge.py:60-81`)
   maps the library's typed events one-to-one onto named SSE events:
   `generated`, `validated`, `fix`, `stalled`, `max_iterations`,
   `completed`, and the pre-flight trio `parse_warning` / `unmapped_tables` /
   `unmapped_columns`. Any exception in the run is surfaced as a synthetic
   `error` event by the bridge's runner (`backend/app/bridge.py:104-106`;
   [errors.md](errors.md)).
7. **The store reducer.** The `onEvent` switch
   (`frontend/src/hooks/useStore.ts:474-553`) folds each event into the
   `stream` slice: status transitions, the latest generated query,
   validation errors, iteration counters, and, on `completed`, the full
   `TranslationResult` fields. See [state.md](state.md).
8. **Re-render.** Components subscribe via selectors: the chat sidebar
   repaints on each `conversation` snapshot, the outcome panel on the query
   and verdict fields, and the workspace bar flips Translate to Stop via
   `RUNNING_STATUSES` membership (`frontend/src/hooks/useStore.ts:27`). No
   component touches the network during the run; everything flows through
   the store ([frontend.md](frontend.md)).
