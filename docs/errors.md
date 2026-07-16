# Error handling

**Every way a run can fail, which channel carries the failure, and where it
surfaces in the UI.**

The web app adds no recovery logic of its own: the library decides what is
fatal, the backend forwards it, the frontend renders it. This page maps each
failure to its channel.

## Scope

This page owns the failure paths across the stack: the pre-stream HTTP 400
contract, the synthetic `error` SSE event, transport failures, the fail-soft
REST endpoints, and the warn-versus-reject pre-flight policy. Related topics
live with their owners:

- [streaming.md](streaming.md): the healthy stream this page is the
  counterpart of (event lifecycle, bridge coalescing, store reducer).
- [api.md](api.md): request/response semantics of every endpoint.
- [state.md](state.md): the store slices these failures reduce into.

---

## The failure channels

| Channel | Trigger | Backend site | Wire shape | Frontend handler | User-visible result |
|---|---|---|---|---|---|
| HTTP 400 before the stream | Invalid input detectable before any work starts (empty SQL/DDL, bad config, unparseable DDL) | `backend/app/api.py:233-238`, `backend/app/api.py:175-185` | Status 400, JSON `{"detail": "..."}`, no stream | `onopen` throws `FatalSseError`; the final catch reports it (`frontend/src/lib/api.ts:129-139`, `frontend/src/lib/api.ts:155-158`) | Result footer: `Error: <detail>` |
| Synthetic `error` SSE event | Any exception inside the running translation or build (LLM auth failure, unreachable host, DB connection refused, Docker down in managed mode) | `backend/app/bridge.py:104-106`, `backend/app/bridge.py:172-174` | SSE `event: error`, `data: {"message": "<ExcType>: <detail>"}` | Reducer `case "error"` (`frontend/src/hooks/useStore.ts:546-548`); build `onError` (`frontend/src/hooks/useStore.ts:595-596`) | Result footer: `Error: <message>`; the partial transcript stays |
| Transport failure | Network drop mid-stream, backend process death, a proxy answering with a non-SSE response | None (nothing usable reaches the wire) | None, or a non-SSE body | `onerror` reports and throws to stop auto-retry (`frontend/src/lib/api.ts:149-154`) | Result footer: `Error: <transport message>` |
| User-initiated Stop (not an error) | Stop button, Clear during a build, closing the build flow | Generator `finally` cancels the task (`backend/app/bridge.py:134-138`); `CancelledError` triggers the translator's `__aexit__` teardown | Client aborts the HTTP request | `stop()` aborts the controller (`frontend/src/hooks/useStore.ts:566-569`); the catch sees `signal.aborted` and returns (`frontend/src/lib/api.ts:156`) | Footer returns to idle; nothing is reported |

Loop-level failures (`max_iterations_reached`, `stalled`) and pre-flight
rejects are deliberately absent from this table: they travel on the healthy
channel, as a `completed` event whose `result.status` is not `success`.
[streaming.md](streaming.md) owns that lifecycle; the last two sections here
cover the pre-flight subset.

---

## HTTP 400 before the stream

Both SSE endpoints validate everything they can before returning the
`EventSourceResponse`, so a configuration mistake fails as a plain HTTP error
instead of a stream that opens only to carry one `error` event.

| Endpoint | Precondition rejected as 400 | Guard |
|---|---|---|
| `/api/translate` | Empty SQL | `backend/app/api.py:233-234` |
| `/api/translate` | Translator construction fails: a mapping that fails schema validation (`ValidationError` from `SchemaMapping.from_yaml_string`, `backend/app/library.py:179`), an invalid model config, or a validation mode not valid for the target (`backend/app/library.py:173-178`) | caught as `(ValidationError, ValueError, TypeError)` at `backend/app/api.py:235-238` |
| `/api/build-mapping-stream` | Empty DDL | `backend/app/api.py:175-176` |
| `/api/build-mapping-stream` | Unparseable DDL (`DdlParseError` from `extract_schema_from_ddl`) | `backend/app/api.py:178-180` |
| `/api/build-mapping-stream` | Invalid model config, checked only when `refine` is true (a deterministic build calls no model) | `backend/app/api.py:181-185` |

The `detail` string becomes the `FatalSseError` message on the client, so the
footer shows the library's own wording (for example a Pydantic message for a
bad temperature).

One edge is traceable in the guard itself: a mapping that is not even valid
YAML raises `yaml.YAMLError`, which is not in the tuple caught at
`backend/app/api.py:237`, so it surfaces as a 500 rather than a 400. The
client renders it through the same `onopen` path as `HTTP 500`. It is
unreachable through the UI because `canTranslate` requires a valid active
mapping (see below); the 400 guards exist for direct API callers.

---

## The synthetic error event

Once the stream is open the HTTP status is committed (200), so mid-run
failures need an in-band channel. The bridge's `runner` is the catch-all
(`backend/app/bridge.py:98-108`):

- `except Exception` logs the full traceback with `logger.exception` and
  enqueues exactly one `error` event whose message is
  `f"{type(exc).__name__}: {exc}"` (`backend/app/bridge.py:104-106`).
- `asyncio.CancelledError` is re-raised first (`backend/app/bridge.py:102-103`)
  so a client disconnect or Stop tears the run down without masquerading as a
  translation failure.
- The `finally` enqueues the `None` sentinel (`backend/app/bridge.py:108`), so
  the stream terminates cleanly whether the run succeeded, errored, or was
  cancelled (`backend/app/bridge.py:131-132`).

`stream_build_mapping` repeats the pattern verbatim for the build flow
(`backend/app/bridge.py:164-176`), with `done` in place of `completed`.
Typical exceptions reaching this handler: an Anthropic authentication error,
an Ollama host refusing connections, a Neo4j login failure, or `testcontainers`
with no Docker daemon in managed mode.

---

## Transport errors and FatalSseError

The client side of both streams lives in `frontend/src/lib/api.ts` and layers
three defenses around `fetchEventSource`:

- **`FatalSseError`** (`frontend/src/lib/api.ts:54`) marks "the response
  itself was the failure and a readable detail was already extracted".
  `onopen` accepts only `res.ok` with a `text/event-stream` content type;
  anything else (a 400 with a JSON `detail`, a proxy's HTML error page) gets
  its body parsed for `detail`, falling back to `HTTP <status>`, and thrown as
  `FatalSseError` (`frontend/src/lib/api.ts:129-139`).
- **`onerror` throws** (`frontend/src/lib/api.ts:149-154`). fetch-event-source
  retries on error by default; retrying here would re-POST `/api/translate`
  and silently start a second LLM run. The handler reports the message and
  rethrows to kill the retry loop. `openWhenHidden: true`
  (`frontend/src/lib/api.ts:128`) exists for the same reason: without it a tab
  switch would close and re-open the stream, restarting the run.
- **The final catch** (`frontend/src/lib/api.ts:155-158`) is the terminal
  filter: an aborted signal means the user pressed Stop (return silently, not
  an error); a `FatalSseError` reaches `onError` with the parsed detail. A
  `FatalSseError` thrown in `onopen` also passes through `onerror` on the way,
  so `onError` can fire twice for a 400; both writes set the same state
  (`status: "error"` plus the message), so the duplication is harmless.

If the server closes the stream without ever delivering `completed`, the
store's `onClose` normalizes a still-running status to `done`
(`frontend/src/hooks/useStore.ts:554-561`), so a truncated stream cannot leave
the UI stuck in a running state.

---

## Fail-soft REST endpoints

The three live-feedback endpoints never answer 4xx for bad user input; they
return a soft result instead:

| Endpoint | Failing input | Response (still 200) | Site |
|---|---|---|---|
| `/api/validate-mapping` | YAML parse error or schema violation | `valid: false` plus human-readable errors | `backend/app/api.py:114-120` |
| `/api/detect-features` | Empty SQL | `features: []`, `parse_ok: true` | `backend/app/api.py:197-198` |
| `/api/detect-features` | Unparseable SQL | `parse_ok: false` (features from the library's fail-open analysis) | `backend/app/api.py:199-200` |
| `/api/check-coverage` | Empty SQL | empty lists, `parse_ok: true` | `backend/app/api.py:213-214` |
| `/api/check-coverage` | Unparseable SQL | empty lists, `parse_ok: false` | `backend/app/api.py:215-217` |
| `/api/check-coverage` | Invalid mapping | empty lists (the mapping editor's own validity indicator reports the YAML errors) | `backend/app/api.py:218-221` |

The rationale: these endpoints run debounced on every keystroke (the validity
indicator, the feature chips, the coverage banner). A 4xx per keystroke would
flash error banners while the user is mid-edit. The client helpers do throw on
a non-2xx status (`frontend/src/lib/api.ts:30`, `frontend/src/lib/api.ts:40`,
`frontend/src/lib/api.ts:50`), but the feature and coverage refreshers catch
and keep the previous value (`frontend/src/hooks/useStore.ts:419-424`,
`frontend/src/hooks/useStore.ts:437-442`), while the two validity refreshers
catch and reset to null (`frontend/src/hooks/useStore.ts:393-397`,
`frontend/src/hooks/useStore.ts:406-410`), so a dead backend degrades to
stale or cleared hints (and a disabled Translate button) rather than error
banners.

---

## Pre-flight signals: warn vs reject

The library runs its pre-flight gate before any LLM call; the bridge forwards
the gate's events verbatim (`backend/app/bridge.py:62-67`). The web backend
passes none of the three action overrides (`backend/app/library.py:193-200`),
so the library defaults apply
(`../sql2graph/src/sql2graph/engine/async_translator.py:77-79`). At most one
signal fires per run, checked in order: parse, then tables, then columns
(`../sql2graph/src/sql2graph/engine/preflight.py:163-179`).

| Signal | Severity (default) | Does translation proceed | Event | Resulting `completed.status` |
|---|---|---|---|---|
| SQL does not parse | warn | yes | `parse_warning` | whatever the loop produces (`success`, `max_iterations_reached`, `stalled`) |
| Unmapped tables | reject | no, the LLM is never called | `unmapped_tables`, then `completed` | `unmapped_tables` |
| Unmapped columns | reject | no, the LLM is never called | `unmapped_columns`, then `completed` | `unmapped_columns` |

Some store comments still describe the columns check as warn-by-default
(`frontend/src/hooks/useStore.ts:110-115`); the library default is reject.
The reducer tolerates both policies
(`frontend/src/hooks/useStore.ts:492-496`): under warn the banner shows and
the run continues, under the current reject default a `completed` with the
matching status follows immediately. The per-run `parse_warning` message lands
in `stream.parseWarning` (`frontend/src/hooks/useStore.ts:484-486`), but the
surface the user actually sees is the live banner driven by `sqlParseOk`,
which shows the same condition before the run even starts.

The UI mirrors the reject policy before a request is ever sent. `canTranslate`
(`frontend/src/hooks/useStore.ts:445-461`) requires: no run in flight,
non-empty SQL, a valid active mapping, and zero live coverage findings for
both tables and columns (fed by the debounced `/api/check-coverage`). A parse
failure deliberately does not gate: it is a warning and the run proceeds.
`WorkspaceBar` re-derives the same predicate for the Translate button and
shows the blocking reason as a hint
(`frontend/src/components/WorkspaceBar.tsx:91-111`). A reject can still reach
the backend on a debounce race (coverage not yet refreshed when the user
clicks); the library then rejects programmatically and the run costs zero
tokens.

---

## What the user sees

Each channel resolves to one UI surface; none of them stacks a modal or a
toast. Component structure and the shared primitives (`IssueStrip`,
`StatusText`) are covered in [frontend.md](frontend.md).

| Failure | Surface | Code |
|---|---|---|
| Live pre-flight: parse warning | Amber strip above the SQL editor; the SQL is still sent | `frontend/src/components/SqlPreflightBanner.tsx:25` |
| Live pre-flight: unmapped tables or columns | Rose strip listing the names; Translate disabled with a hint | `frontend/src/components/SqlPreflightBanner.tsx:17-26`, `frontend/src/components/WorkspaceBar.tsx:93-111` |
| HTTP 400, `error` event, transport failure | Result footer `Error: <message>`; the partial transcript stays in the chat sidebar | `frontend/src/components/OutcomePanel.tsx:92` |
| Pre-flight reject that slipped past the gate | Footer verdict `unmapped tables` / `unmapped columns`; the iteration, duration, and token chips are suppressed (all zero) | `frontend/src/components/OutcomePanel.tsx:95-100` |
| Loop failure (`max_iterations_reached`, `stalled`); not an error channel | Verdict badge in the footer plus the validation-error strip, with the usual chips | `frontend/src/components/OutcomePanel.tsx:82-117` |
| Build failure (any channel) | Mapping editor footer `Error: <message>` | `frontend/src/components/MappingEditorPanel.tsx:161` |
| Stop | Footer returns to `Ready.`; nothing is reported | `frontend/src/hooks/useStore.ts:566-569` |

The chat sidebar itself never renders errors: it only streams the transcript
(`frontend/src/components/ChatSidebar.tsx`).
