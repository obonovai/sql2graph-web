# sql2graph-web documentation

`sql2graph-web` is a browser UI over the sibling
[`sql2graph`](https://github.com/obonovai/sql2graph) library: a FastAPI
backend that bridges the library's synchronous callbacks to Server-Sent
Events, and a React SPA that renders them. It adds no translation logic of
its own; the library decides, the app displays. These pages are written
against the source and cite the files they describe; install and quick start
live in the [project README](../README.md).

## Suggested reading order

1. [install.md](install.md): from a clean checkout to a running app, whether
   by manual dev servers, a production build, or Docker. The root README
   quick start is the short version of this page.
2. [architecture.md](architecture.md): the mental model. The one-origin
   topology, the module maps on both sides of the stack, and the anatomy of
   one translate run from request to rendered result.
3. [streaming.md](streaming.md): the heart of the app. How the library's
   synchronous callbacks become SSE events on the backend, and how the UI
   consumes them on the other end.
4. [state.md](state.md): where every event lands. The Zustand store as the
   single source of truth for UI and run state.
5. [errors.md](errors.md): the failure channels across the stack, and the
   warn-vs-reject pre-flight model that decides what blocks a run.
6. [api.md](api.md) and [types.md](types.md): the endpoint reference, and the
   cross-language type contract to maintain when changing either side.

## Map

### Foundations

- **[architecture.md](architecture.md)**: the mental model; the one-origin
  topology, the sibling-repo coupling, both module maps, and the anatomy of a
  translate run.

### Runtime

- **[streaming.md](streaming.md)**: the two SSE streams end to end; the
  bridge queue and coalescing, the event vocabulary, run lifecycles,
  teardown, client transport.
- **[state.md](state.md)**: the Zustand store; slices, active versus draft
  mapping, request building, debounced hooks, persistence and migration.
- **[errors.md](errors.md)**: every way a run fails; pre-stream 400s, the
  synthetic error event, transport failures, fail-soft endpoints, warn versus
  reject pre-flight.

### Reference

- **[api.md](api.md)**: the REST reference; all eight routes, request models,
  response payloads, fail-soft semantics, and the pre-stream HTTP 400
  preconditions.
- **[types.md](types.md)**: the backend/frontend type mirror; every mirror
  point, why no codegen, degradation conventions, and the change checklists.
- **[frontend.md](frontend.md)**: SPA structure and conventions; the tech
  stack, the per-file source tree, the two-workspace model, and UI
  conventions.

### Operations

- **[install.md](install.md)**: prerequisites, the sibling-clone layout, the
  three run paths (manual, production, Docker), the environment-variable
  table, checks, troubleshooting.

### The library

- **[../../sql2graph/docs/README.md](../../sql2graph/docs/README.md)**: the
  library's own documentation hub; the relative link works when the repos are
  cloned as siblings, otherwise see
  [github.com/obonovai/sql2graph](https://github.com/obonovai/sql2graph).
