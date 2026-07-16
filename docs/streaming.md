# Streaming

**How the library's synchronous callbacks become the two Server-Sent-Events
streams, and how the frontend reduces those events into UI state.**

## Scope

This page owns the SSE path end to end: the backend bridge (queue, coalescing,
event shaping), the event vocabulary of both streams (translate and
build-mapping), their lifecycles, teardown, and the client transport. Related
topics live with their owners:

- [api.md](api.md): the two endpoints, their request shapes, and the
  pre-stream HTTP 400 contract.
- [errors.md](errors.md): the failure channels (HTTP 400 vs the `error` event
  vs transport failures).
- [state.md](state.md): the Zustand store these events reduce into.
- [architecture.md](architecture.md): where the streams sit in the overall
  topology; [README.md](README.md): the full doc map.

---

## The bridge: synchronous callbacks to an async stream

The library's observer hooks are plain synchronous callables:
`AsyncSQLTranslator.translate()` accepts `on_event` and `on_conversation`
(`../sql2graph/src/sql2graph/engine/async_translator.py:111-117`) and invokes
them inline, on the same event-loop task that runs `translate()` itself. A
callback therefore cannot `await`, and there is no second thread anywhere: the
handoff to the SSE generator must be non-blocking and same-loop. The bridge's
module docstring states exactly this contract (`backend/app/bridge.py:1-20`).

`stream()` (`backend/app/bridge.py:84-138`) turns that contract into an async
generator that `sse-starlette`'s `EventSourceResponse` consumes
(`backend/app/api.py:29`, `backend/app/api.py:239`):

- **Milestone events** are shaped by `_event_to_sse`
  (`backend/app/bridge.py:60-81`) and pushed with `put_nowait` onto an
  unbounded `asyncio.Queue` (`backend/app/bridge.py:95-96`): never `await`
  (impossible in a sync callable), never a threading queue (there is no other
  thread). The drain loop forwards them immediately.
- **A runner task** (`backend/app/bridge.py:98-108`, spawned at
  `backend/app/bridge.py:115`) runs `translate()` concurrently with the
  generator, inside `async with translator` so resources are released on every
  exit path (see teardown below). Any non-cancellation exception becomes an
  `error` event; a `None` sentinel always ends the queue.
- **The transcript** relies on `on_conversation` alone. Setting it already
  implies token streaming from the LLM even when `stream_to` is `None`, and
  each snapshot carries the growing assistant text
  (`../sql2graph/src/sql2graph/engine/async_translator.py:132-136`), so the
  bridge never registers a separate `stream_to` callback.

```
runner task (translate())                 SSE generator (drain loop)

on_event(e)        -> queue.put_nowait    -> yield immediately
on_conversation(m) -> latest = m, dirty   -> flushed at most every 0.08 s
finally            -> put_nowait(None)    -> break, response closes
```

Each yielded item is a `{"event", "data"}` dict with the data pre-serialized
to a JSON string, the shape `sse-starlette` requires
(`backend/app/bridge.py:55-57`).

---

## Conversation coalescing

`on_conversation` fires per token, and every invocation resends the **entire**
message list. Forwarding each snapshot would send quadratic bytes for no
visible gain, so the callback only overwrites `latest_conversation` and marks
it dirty (`backend/app/bridge.py:90-93`); the drain loop does the rate
limiting:

- The loop waits on the queue with
  `asyncio.wait_for(queue.get(), timeout=_COALESCE_SECONDS)`
  (`backend/app/bridge.py:117-124`). On timeout it flushes at most one
  `conversation` event and keeps waiting.
- `_COALESCE_SECONDS = 0.08` (`backend/app/bridge.py:52`) caps the transcript
  at ~12 snapshots per second, matching the CLI's Rich `Live`
  `refresh_per_second`.
- **Flush before milestone**: when a milestone event arrives, any pending
  snapshot is yielded first (`backend/app/bridge.py:126-129`). The transcript
  therefore never lags the milestone it produced; a `generated` event cannot
  precede the assistant text it refers to.

Because a snapshot is the full transcript, dropping intermediate snapshots
loses nothing: the last one flushed always supersedes everything before it.
`stream_build_mapping` repeats the identical pattern for the build stream
(`backend/app/bridge.py:178-191`).

---

## Event vocabulary

Short file names below: `bridge.py` is `backend/app/bridge.py`, `useStore.ts`
is `frontend/src/hooks/useStore.ts` (consumers are the reducer inside its
`translate()` action), `api.ts` is `frontend/src/lib/api.ts`. The TypeScript
mirror unions are `SseEvent` (`frontend/src/lib/types.ts:184-196`) and
`BuildMappingSseEvent` (`frontend/src/lib/types.ts:130-133`); the mirror
contract itself is owned by [types.md](types.md).

| Event | Stream | Payload | Produced at | Consumed at | Store effect |
|---|---|---|---|---|---|
| `status` | translate | `{phase: "provisioning"}` | `bridge.py:112-113` | `useStore.ts:481-483` | `status = "provisioning"` |
| `conversation` | both | `Message[]` (full transcript snapshot) | `bridge.py:121-129` (translate), `bridge.py:184-191` (build) | `useStore.ts:497-500`; build: `api.ts:91`, `useStore.ts:589` | replaces `stream.conversation`; bumps `provisioning`/`idle` to `generating`; build: replaces `build.conversation` |
| `parse_warning` | translate | `{message}` | `bridge.py:62-63` | `useStore.ts:484-487` | sets `parseWarning`; run continues |
| `unmapped_tables` | translate | `{tables, message}` | `bridge.py:64-65` | `useStore.ts:488-491` | sets `unmappedTables`; a reject, so `completed` follows without an LLM call |
| `unmapped_columns` | translate | `{columns, message}` | `bridge.py:66-67` | `useStore.ts:492-495` | sets `unmappedColumns`; a reject by default (`../sql2graph/src/sql2graph/engine/async_translator.py:79`), so `completed` follows without an LLM call; the run only continues when the action is configured to warn |
| `generated` | translate | `{iteration, query}` | `bridge.py:68-69` | `useStore.ts:501-506` | sets query + iteration; `status = "validating"` |
| `validated` | translate | `{iteration, query, errors, passed}` | `bridge.py:70-71` | `useStore.ts:507-513` | sets `validationErrors`/`validationPassed`; `status = "fixing"` when failed |
| `fix` | translate | `{iteration, query}` | `bridge.py:72-73` | `useStore.ts:514-518` | replaces query; `currentIteration = iteration + 1`; `status = "validating"` |
| `stalled` | translate | `{iteration, query, errors}` | `bridge.py:74-75` | `useStore.ts:519-525` | `status = "fixing"`, `stalled = true` (drives the "escalating" label) |
| `max_iterations` | translate | `{iteration, errors}` | `bridge.py:76-77` | `useStore.ts:526-528` | stores the final errors; `completed` follows |
| `completed` | translate | `{result: TranslationResult}` | `bridge.py:78-79` | `useStore.ts:529-545` | copies the full result into `stream`; `status = "done"` |
| `error` | both | `{message}` | `bridge.py:104-106` (translate), `bridge.py:172-174` (build) | `useStore.ts:546-548`; build: `api.ts:93`, `useStore.ts:595-596` | `status = "error"` plus the message |
| `done` | build | `GeneratedMapping` (`frontend/src/lib/types.ts:153-165`) | `bridge.py:166-169` | `api.ts:92`, `useStore.ts:590-594` | sets `build.result`, `build.status = "done"`, writes `form.draftMappingYaml` |

Every translate milestone row is a 1:1 rename of a library iteration event
(`ParseFailedEvent -> parse_warning`, `GeneratedEvent -> generated`, and so
on) in the `match` at `backend/app/bridge.py:60-81`; the payload fields are
the dataclass fields. `status`, `conversation`, `error`, and `done` are the
only events the web layer adds.

---

## Lifecycle of a translate run

`POST /api/translate` builds the translator before any streaming starts, so
config errors surface as HTTP 400, not as stream events
(`backend/app/api.py:229-239`; the contract is detailed in
[errors.md](errors.md)). `build_translator` also resolves the effective
validation mode: `server` with an empty connection form resolves to `managed`
(`backend/app/library.py:169-201`).

On the frontend, `translate()` (`frontend/src/hooks/useStore.ts:463-564`)
resets the `stream` slice and sets `status = "generating"` before the request
even opens (`frontend/src/hooks/useStore.ts:467-470`), then reduces every SSE
event through one `switch` (`frontend/src/hooks/useStore.ts:480-550`).

Three phases worth tracing:

- **Managed-mode provisioning.** The bridge yields
  `status {phase: "provisioning"}` before the runner task starts
  (`backend/app/bridge.py:110-115`), because the throwaway database boots
  inside `translate()`'s validator warmup, before the conversation and
  generate/validate events fire (a warn-level preflight event can still
  precede warmup, and a preflight reject skips warmup entirely,
  `../sql2graph/src/sql2graph/engine/async_translator.py:142-168`). The
  first `conversation` snapshot only arrives once the system prompt exists,
  i.e. after warmup, so the reducer uses it to move `provisioning` back to
  `generating` (`frontend/src/hooks/useStore.ts:497-500`).
- **Happy path.** Snapshots stream while the model generates; `generated`
  flips the status to `validating`; a passing `validated` leaves it there for
  the instant before `completed` copies in the final result and lands on
  `done`.
- **Fix loop.** A failing `validated` flips to `fixing`; the next `fix` event
  carries the repaired candidate and returns to `validating` with the
  iteration counter advanced. When the loop escalates, a `stalled` event fires
  first (the reducer stays on `fixing` and sets `stalled = true`, driving the
  "escalating" label), then the fresh, hotter retry streams and its candidate
  still arrives as a normal `fix` event: `FixGeneratedEvent` is emitted on
  both the fix and escalation paths
  (`../sql2graph/src/sql2graph/engine/async_translator.py:319-332`). An
  exhausted loop emits `max_iterations` and then `completed`.

```
backend emits                             store status becomes

# managed mode only, before the runner task starts
status {phase: "provisioning"}            provisioning

# happy path
conversation [...]   (repeats, ~12 fps)   generating
generated {iteration: 1, query}           validating
validated {iteration: 1, passed: true}    validating   (completed follows)
completed {result}                        done

# fix loop, spliced in after a failing validation
validated {iteration: N, passed: false}   fixing
stalled {iteration: N, query, errors}     fixing       (stalled = true; escalation only)
conversation [...]                        fixing
fix {iteration: N, query}                 validating   (currentIteration = N + 1)
max_iterations {iteration, errors}        fixing       (unchanged; completed follows)
completed {result}                        done
```

Pre-flight events (`parse_warning`, `unmapped_tables`, `unmapped_columns`) may
arrive before `generated`; a reject skips the LLM entirely and jumps straight
to `completed`. The compact form of the lifecycle:
`status? -> conversation* -> generated -> validated -> (stalled? -> fix ->
validated)* -> completed | max_iterations | error`.

Two safety nets close the loop: if the stream ends without a terminal event,
`onClose` forces `done` (`frontend/src/hooks/useStore.ts:554-561`); a
transport failure lands in `onError` and becomes `status = "error"`
(`frontend/src/hooks/useStore.ts:562`).

---

## Lifecycle of a build-mapping run

`POST /api/build-mapping-stream` rejects empty DDL, unparseable DDL, and (when
refining) an invalid model config as HTTP 400 before streaming
(`backend/app/api.py:163-186`). The stream itself has a two-event vocabulary
plus `error`: there are no milestone events, because the build's only LLM work
is a single guarded naming pass, so the transcript is the only live signal.

`stream_build_mapping` (`backend/app/bridge.py:141-200`) runs
`library.build_mapping_from_ddl_async` (`backend/app/library.py:96-123`) in
the same runner-plus-queue shape as `stream()`:

- **`refine = true`**: the naming pass streams `conversation` snapshots
  through the identical coalescing loop, then `done` carries the full
  `GeneratedMapping` dict: the refined YAML, the deterministic skeleton, the
  rename diff, the coverage report, and token usage
  (`backend/app/bridge.py:166-169`, shaped in
  `backend/app/library.py:43-64`).
- **`refine = false`**: no LLM client is even constructed; the deterministic
  build returns immediately and only `done` fires
  (`backend/app/library.py:115-117`).

On the frontend, `buildMapping()`
(`frontend/src/hooks/useStore.ts:576-599`) mirrors `translate()` into the
`build` slice: `conversation` snapshots feed the shared chat sidebar, and
`onDone` stores the result, writes `result.mapping_yaml` into
`form.draftMappingYaml` (the draft, never the active mapping), and refreshes
the draft validity (`frontend/src/hooks/useStore.ts:590-594`). The dispatch
from raw SSE messages to the three handlers lives in `buildMappingStream`
(`frontend/src/lib/api.ts:62-107`).

---

## Stop, disconnect, and teardown

**Frontend.** The Stop button calls `stop()`
(`frontend/src/hooks/useStore.ts:566-569`), which fires the run's
`AbortController`; `fetch-event-source` aborts the underlying fetch. The
client treats an aborted signal as "user pressed Stop", not an error
(`frontend/src/lib/api.ts:155-158`; build: `frontend/src/lib/api.ts:103-106`
and `stopBuild()` at `frontend/src/hooks/useStore.ts:601-604`).

**Backend.** The abort closes the HTTP connection, `sse-starlette` closes the
async generator, and the generator's `finally` cancels the runner task
(`backend/app/bridge.py:134-138`). `asyncio.CancelledError` then propagates
through whatever `translate()` is awaiting (an LLM call, a validator round
trip), and the runner re-raises it rather than converting it to an `error`
event (`backend/app/bridge.py:102-103`).

**Teardown is the same code on every path.** The runner holds the translator
in `async with` (`backend/app/bridge.py:100-101`), so normal completion,
failure, and cancellation all exit through `__aexit__`
(`../sql2graph/src/sql2graph/engine/async_translator.py:100-109`), which calls
`close()` to release the validator and then the LLM client
(`../sql2graph/src/sql2graph/engine/async_translator.py:342-351`). For a
managed run that includes stopping the throwaway database container. The build
stream closes its LLM client in a `finally` the same way
(`backend/app/library.py:118-122`).

---

## The client transport

Both streams use `@microsoft/fetch-event-source`
(`frontend/src/lib/api.ts:4`) instead of the native `EventSource`:

- **POST-based SSE.** `EventSource` can only issue a GET with no body. Both
  streams need a full JSON request (SQL, the entire mapping YAML, LLM and
  server settings, including credentials that must not appear in a URL), so
  the SSE wire protocol has to run over `fetch`
  (`frontend/src/lib/api.ts:123-127`).
- **`openWhenHidden: true`** (`frontend/src/lib/api.ts:76` and `:128`). By
  default the library aborts the stream when the tab is hidden and reopens it
  on visibility; reopening would re-POST and restart the run, so a translation
  must keep consuming in a background tab.
- **The `onopen` content-type check** (`frontend/src/lib/api.ts:129-140`;
  build: `:77-87`). A non-stream response (typically a 400 with a JSON
  `detail`, see [errors.md](errors.md)) is detected by `res.ok` plus a
  `text/event-stream` content-type test, its detail extracted, and a
  `FatalSseError` (`frontend/src/lib/api.ts:54`) thrown so the failure
  surfaces through `onError` instead of being parsed as a stream.
- **No auto-retry.** `onerror` re-throws (`frontend/src/lib/api.ts:149-154`)
  because the library's default is to retry the request, which would silently
  re-run a paid translation.

`onmessage` re-assembles each frame into the typed union
(`frontend/src/lib/api.ts:141-144`) and hands it to the store; the reducer in
[state.md](state.md) takes over from there.
