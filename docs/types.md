# The type contract

**The backend's Pydantic models and the frontend's TypeScript types are mirrored by hand: this page lists every mirror point and what to touch when either side changes.**

## Scope

This page owns: the maintenance contract between the backend shapes (request
models, SSE payloads, result dicts) and `frontend/src/lib/types.ts`. Related
topics live with their owners:

- [api.md](api.md): the wire surface these types describe, endpoint by endpoint.
- [streaming.md](streaming.md): the SSE lifecycle whose event payloads appear here only as type shapes.
- [state.md](state.md): the Zustand store where the frontend types are consumed.
- [README.md](README.md): the full doc map.

---

## The mirror points

`frontend/src/lib/types.ts` is nearly the entire frontend mirror: one
hand-written file, plus the one inline parameter type in
`frontend/src/lib/api.ts:62-63` noted in the table. Its header
(`frontend/src/lib/types.ts:1-3`) names its two backend sources; the constant
block in `backend/app/models.py:14-21` is comment-marked as a restatement of
the library tuples (it does not name the frontend). When a cell in the middle
column changes, the right column is the edit.

| What | Backend source of truth | Frontend mirror |
|---|---|---|
| `LlmSettings` (request) | `backend/app/models.py:24-39` | `frontend/src/lib/types.ts:10-19` |
| `ServerSettings` (request) | `backend/app/models.py:42-57` | `frontend/src/lib/types.ts:21-30` |
| `ValidationSettings` (request) | `backend/app/models.py:60-63` | `frontend/src/lib/types.ts:32-36` |
| `TranslateRequest` (request) | `backend/app/models.py:66-74` | `frontend/src/lib/types.ts:38-45` |
| `BuildMappingBody` (request) | `backend/app/models.py:92-105` | inline parameter type of `buildMappingStream`, `frontend/src/lib/api.ts:62-63` (reuses `LlmSettings`) |
| String unions (`Provider`, `Target`, `ValidationMode`, `ServerType`) | library tuples: `VALID_PROVIDERS` (`../sql2graph/src/sql2graph/llm/__init__.py:47`), `VALID_TARGETS` (`../sql2graph/src/sql2graph/targets/__init__.py:37`), `VALID_VALIDATION_MODES` and `TARGET_SERVER_TYPE` (`../sql2graph/src/sql2graph/validators/__init__.py:103-106`); restated as `Literal`s in `backend/app/models.py:18-21` | `frontend/src/lib/types.ts:4-7` |
| Translate SSE payloads | `_event_to_sse` in `backend/app/bridge.py:60-81`, plus the bridge-origin `error`, `status`, and `conversation` events (`backend/app/bridge.py:106`, `112-113`, `119-129`) | the `SseEvent` union, `frontend/src/lib/types.ts:184-196` |
| Build-mapping SSE payloads | `stream_build_mapping`, `backend/app/bridge.py:141-200` (`done` at `:169`, `error` at `:174`) | the `BuildMappingSseEvent` union, `frontend/src/lib/types.ts:130-133` |
| Build result (`done` payload) | `_build_result_to_dict`, `backend/app/library.py:43-64` | `GeneratedMapping`, `frontend/src/lib/types.ts:153-165`, with its nested `MappingGraph`, `MappingDiff`, `CoverageReport` |
| Options payload | the `options()` handler, `backend/app/api.py:71-99` | `Options`, `frontend/src/lib/types.ts:167-181` |
| Small endpoint responses | `validate_mapping` (`backend/app/api.py:107-128`), `detect` (`backend/app/api.py:189-200`), `check_coverage` (`backend/app/api.py:203-226`) | `MappingValidity`, `FeatureDetection`, `CoverageCheck` in `frontend/src/lib/types.ts:108-114`, `:199-209` |

Two of the mirrored shapes originate one level deeper, in the library rather
than the backend: `TranslationResult` and `TokenUsage`
(`frontend/src/lib/types.ts:52-77`) mirror the library models in
`../sql2graph/src/sql2graph/engine/state.py` and
`../sql2graph/src/sql2graph/llm/usage.py` as serialised by
`result.model_dump()` (`backend/app/bridge.py:79`), and `MappingGraph` mirrors
the library's `SchemaMapping.model_dump()` (`backend/app/library.py:54-56`).

The string unions exist in three copies on purpose. The library tuples are the
runtime truth; `/api/options` serves them verbatim
(`backend/app/api.py:78-80`), so the UI's dropdowns always list what the
installed library actually supports. The `Literal`s in
`backend/app/models.py:18-21` cannot be derived from those tuples because
`typing.Literal` requires compile-time members (the comment at
`backend/app/models.py:14-17` says exactly this); they are what rejects an
out-of-range request with a 422. The TypeScript unions at
`frontend/src/lib/types.ts:4-7` are what the compiler checks. Drift therefore
has one observable shape: a member the library ships but the `Literal` lacks
is offered by the UI (via `/api/options`) and then rejected by request
validation.

---

## Why there is no codegen

Not generating the TypeScript from the backend is a decision, not an
omission:

- **The surface is small.** Five request models, two SSE unions, and a
  handful of response dicts; the whole mirror is one file of about 200 lines.
- **The interesting half is invisible to a generator.** An OpenAPI-based tool
  (openapi-typescript and kin) sees only the request models. The two SSE
  endpoints return `EventSourceResponse` with payloads shaped as plain dicts
  (`_sse` json-dumps them, `backend/app/bridge.py:55-57`), and `options()` and
  `_build_result_to_dict` return `dict[str, Any]`; none of that reaches the
  OpenAPI schema. The parts that actually change would stay hand-maintained
  either way, at the cost of a build step and a second type source.
- **The frontend side is comment-marked as a mirror.** The types.ts header
  (`frontend/src/lib/types.ts:1-3`) names its two backend sources, so an edit
  on the frontend side is sent to the backend; the models.py comment
  (`backend/app/models.py:14-17`) points one level deeper, at the library
  tuples it restates, and does not name the frontend.

The honest caveat: manual sync can drift, and nothing fails at build time
when it does. The mirror-points table above is the checklist that keeps the
contract honest, and the [change checklist](#change-checklist) below is the
procedure.

---

## Graceful-degradation conventions

The backend imports the sibling library as an editable install, so the web
app must render against library builds that predate its newest fields. The
convention: a field that newer library versions add is typed optional in
types.ts, and every consumer supplies a fallback, so the UI typechecks and
renders (minus the new detail) against an older build.

| Optional field | Declared | Absent when | Consumer fallback |
|---|---|---|---|
| `TranslationResult.token_usage` | `frontend/src/lib/types.ts:75-76` | the installed library predates token accounting | `r.token_usage ?? null` in the `completed` reducer case, `frontend/src/hooks/useStore.ts:541` |
| `GraphNode.property_types`, `GraphEdge.property_types` | `frontend/src/lib/types.ts:86-89`, `:100` | the library predates typed properties (sparse even when present: only typed properties appear) | `propertyTypes?.[key]` in the graph detail panel, `frontend/src/components/MappingGraph.tsx:302`; properties render without a type badge |
| `Options.validation_modes_by_target` (required in the type, guarded in the consumer) | `frontend/src/lib/types.ts:171` | options have not loaded yet, or an older backend omits the per-target map | `modesForTarget` falls back to the full `["none", "syntax", "server"]` set, `frontend/src/hooks/useStore.ts:184-186` |

---

## Change checklist

### A new request field

1. Add the field to the model in `backend/app/models.py`.
2. Thread it through the adapter in `backend/app/library.py`
   (`build_model_config`, `build_server_config`, or `build_translator`); the
   `_clean` helper (`backend/app/library.py:37-40`) drops `None` values so the
   library keeps its own default when the form leaves the field unset.
3. Mirror it in the matching interface in `frontend/src/lib/types.ts`.
4. Surface it in the form component that edits it, and in the store's request
   builder (see [state.md](state.md)).

### A new SSE event

1. Emit it: a new match arm in `_event_to_sse`
   (`backend/app/bridge.py:60-81`), or a direct `_sse(...)` yield for a
   bridge-origin event.
2. Add the member to the `SseEvent` union
   (`frontend/src/lib/types.ts:184-196`).
3. Handle it: a new case in the reducer switch inside `translate()`
   (`frontend/src/hooks/useStore.ts:480-550`). A missing case is a silent
   no-op, not a compile error, so add it deliberately.
4. Document it in the event table in [streaming.md](streaming.md).

### A new enum member (target, provider, validation mode)

1. Extend the library first: the runtime tuple plus everything it gates
   (the recipes live in `../sql2graph/docs/extending.md`).
2. Widen the `Literal` in `backend/app/models.py:18-21`.
3. Widen the union in `frontend/src/lib/types.ts:4-7`.

No `/api/options` change is needed for a new provider, a new validation mode,
or a new target that reuses an existing server type: the handler already
serves the library tuples at runtime, so the dropdowns pick the new member up
on their own. A target that introduces a new server type also needs a
`server_defaults` row in the handler (`backend/app/api.py:89-93`).
