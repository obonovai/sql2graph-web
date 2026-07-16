# Frontend state

**All UI and run state lives in one Zustand store
(`frontend/src/hooks/useStore.ts`); components subscribe via selectors and
mutate only through named store actions.**

## Scope

This page owns: the store's slices and their lifecycles, the form's
two-mapping model, the derived helpers and request building, the debounced
side-effect hooks, and persistence. Related topics live with their owners:

- [streaming.md](streaming.md): the SSE lifecycle end to end and the
  per-event table the store's reducer consumes.
- [frontend.md](frontend.md): the components that render this state.
- [errors.md](errors.md): the failure channels behind `stream.errorMessage`
  and `build.errorMessage`.
- [api.md](api.md): the REST endpoints the refresh actions call.

---

## The store at a glance

One store, created once with `create(persist(...))`
(`frontend/src/hooks/useStore.ts:310-311`). The `Store` interface
(`frontend/src/hooks/useStore.ts:198-254`) declares the state slices and
every action; components never call `set` directly.

| Slice | Contents | Persisted? | Reset when |
|---|---|---|---|
| `options` | the `/api/options` payload: providers, defaults, `validation_modes_by_target` | no | refetched by `init()` on every page load |
| UI chrome: `theme`, `leftOpen`, `rightOpen`, `view`, `sqlInner` | theme, the two sidebar toggles, the active workspace tab, the SQL window's inner tab | yes | never |
| `form` (`FormState`) | every user input: target, LLM and validation settings, active + draft mapping, SQL, DDL, dialect, `refineWithLlm` | yes | `clearWorkspace()` wipes `sql`; `clearMapping()` wipes `ddl` + `draftMappingYaml`; the rest never resets |
| `mappingValidity`, `draftValidity` | server-checked validity of the active and the draft mapping | no | recomputed by the debounced hooks and by `init()` |
| live pre-flight: `features`, `sqlParseOk`, `coverageUnmapped`, `coverageUnmappedColumns` | as-you-type feature detection and mapping-coverage feedback | no | `clearWorkspace()` |
| `stream` + `abort` | the live translation run | no | start of `translate()`; `clearWorkspace()` |
| `build` + `buildAbort` | the live mapping-build run | no | start of `buildMapping()`; `clearMapping()` |

The persisted rows are exactly the `partialize` list (see
[Persistence and migration](#persistence-and-migration)); everything else is
transient by construction, either refetched by `init()` or reset per run.

---

## The form slice: active vs draft mapping

`FormState` (`frontend/src/hooks/useStore.ts:57-78`) holds every user input,
with defaults in `DEFAULT_FORM` (`frontend/src/hooks/useStore.ts:128-147`).
Its central design choice is that two mappings coexist:

| Field | Role | Validity state |
|---|---|---|
| `form.mappingYaml` (`frontend/src/hooks/useStore.ts:63`) | the ACTIVE mapping, the one `translate()` sends; shown and edited in the SQL window's inner schema-mapping tab, or set by Upload there | `mappingValidity` |
| `form.draftMappingYaml` (`frontend/src/hooks/useStore.ts:73`) | the DRAFT, the schema-mapping window's output; built from DDL and hand-editable | `draftValidity` |

The builder only ever writes the draft, so generating a mapping never
disturbs the mapping a translation is currently using. Promotion is
explicit: `useThisMapping(yaml?)`
(`frontend/src/hooks/useStore.ts:609-613`) copies the draft (or a passed
alternative, such as the deterministic skeleton) into `form.mappingYaml`,
refreshes `mappingValidity`, and jumps to the SQL window's mapping tab so
the promoted mapping is visible where it will be used.

The rest of the form:

- `sql` (`frontend/src/hooks/useStore.ts:64`): the SQL query to translate,
  sent by `buildRequest` and watched live by `useFeatureDetection` and
  `useTableCoverage`; wiped by `clearWorkspace()`.
- `ddl` and `dialect` (`frontend/src/hooks/useStore.ts:68-69`): the build
  inputs consumed by `buildMapping()`. `dialect` also flows into
  translation, feature detection, and coverage; its `"generic"` value is a
  UI sentinel converted at the edge (see `toDialect` below).
- `llm` (`LlmSettings`): provider, model, temperature, `max_retries`, plus
  the Ollama knobs (`num_ctx`, `repeat_penalty`, `host`) and
  `max_output_tokens`. Defaults are seeded from the library config via
  `/api/options`, not hardcoded: `init()` fills a blank model and null
  Ollama numerics (`frontend/src/hooks/useStore.ts:339-344`, via
  `modelDefault` at `frontend/src/hooks/useStore.ts:258-261` and
  `ollamaDefault` at `frontend/src/hooks/useStore.ts:267-270`), and
  `setProvider` resets the model to the new provider's default
  (`frontend/src/hooks/useStore.ts:370-371`).
- `validation`: `mode`, `max_iterations`, and a `ServerBag`
  (`frontend/src/hooks/useStore.ts:47-55`), a generic bag of every possible
  server-config field; `buildRequest` picks the relevant subset per target.
  `setTarget` clamps the mode to one valid for the new target
  (`frontend/src/hooks/useStore.ts:362-369`), and `init()` clamps a
  persisted mode that is stale for the current target
  (`frontend/src/hooks/useStore.ts:346-348`).
- `refineWithLlm` (`frontend/src/hooks/useStore.ts:77`): whether the next
  Generate runs the guarded LLM naming pass (draft carries a diff to
  highlight) or produces a fast, deterministic-only draft with no model
  call.

---

## The stream slice

`StreamState` (`frontend/src/hooks/useStore.ts:94-116`) is the live
translation run, reset to `INITIAL_STREAM`
(`frontend/src/hooks/useStore.ts:149-165`) at the start of every
`translate()`. Its `status` is the `Status` union
(`frontend/src/hooks/useStore.ts:22`):

```ts
type Status = "idle" | "provisioning" | "generating" | "validating" | "fixing" | "done" | "error";
```

`RUNNING_STATUSES` (`frontend/src/hooks/useStore.ts:27`) is the exported set
of in-flight statuses (`generating`, `validating`, `fixing`,
`provisioning`), shared by the run-setup bar, the result footer, and the
chat rail so no component re-declares it. `runningLabel(status, opts)`
(`frontend/src/hooks/useStore.ts:32-43`) gives the one label per running
status, shared by `OutcomePanel` and the chat sidebar so the two cannot
drift; `opts.currentIteration` refines the validating text and
`opts.stalled` switches the fixing label to escalation:

| Status | Label |
|---|---|
| `provisioning` | `Setting up throwaway database… (first run can take 10-40s)` |
| `generating` | `Generating query…` |
| `validating` | `Validating (iteration N)…` |
| `fixing` | `Fixing…`, or `Escalating (hotter retry)…` when `stalled` |

During a run the slice accumulates: `conversation` (full snapshots, replaced
wholesale on each event), `generatedQuery`, `currentIteration`,
`validationErrors` and `validationPassed`, the transient `stalled` flag, and
the pre-flight signals (`parseWarning`, `unmappedTables`,
`unmappedColumns`). On completion the terminal fields land:
`durationSeconds`, `iterationsUsed`, `tokenUsage`, and `finalStatus`, the
library's `TranslationResult.status` string (`success`,
`max_iterations_reached`, `stalled`, `unmapped_tables`, `parse_error`; see
`frontend/src/hooks/useStore.ts:103-104`).

The reducer lives inside `translate()`
(`frontend/src/hooks/useStore.ts:463-564`): it resets `stream`, opens the
SSE stream, and folds each event into the slice in one `switch`; `stop()`
(`frontend/src/hooks/useStore.ts:566-569`) aborts the connection via the
stored `AbortController`. The per-event semantics (which event writes which
field, and the bridge coalescing behind it) are owned by
[streaming.md](streaming.md).

Clear: the SQL tab's Clear is `clearWorkspace()`
(`frontend/src/hooks/useStore.ts:629-637`). It resets `stream` to
`INITIAL_STREAM`, wipes `form.sql`, and clears the live pre-flight fields
(`features`, `sqlParseOk`, both coverage lists); it leaves the active and
draft mappings untouched.

---

## The build slice

`BuildState` (`frontend/src/hooks/useStore.ts:85-92`) is the transient state
of the generate-mapping-from-DDL flow, paralleling `stream`: never
persisted, reset to `INITIAL_BUILD`
(`frontend/src/hooks/useStore.ts:167-172`) per run.

| Field | Contents |
|---|---|
| `status` | the `BuildStatus` union (`frontend/src/hooks/useStore.ts:80`): `idle`, `loading`, `done`, `error` |
| `conversation` | the AI naming pass's messages, streamed into the shared chat sidebar |
| `result` | the `GeneratedMapping` (or null); it already carries the run report (`duration_seconds`, `token_usage`) plus the mapping and diff, so consumers read those off `result` directly |
| `errorMessage` | the failure text when `status` is `error` |

`buildMapping()` (`frontend/src/hooks/useStore.ts:576-599`) mirrors
`translate()`: it opens the build SSE stream, reduces `conversation`
snapshots into this slice, and on completion writes the generated YAML into
`form.draftMappingYaml` (the draft, never the active mapping) and refreshes
`draftValidity`. `stopBuild()` (`frontend/src/hooks/useStore.ts:601-604`)
aborts via `buildAbort`. The schema-mapping tab's Clear is `clearMapping()`
(`frontend/src/hooks/useStore.ts:617-625`): it wipes `ddl`,
`draftMappingYaml`, `draftValidity`, and the build run, leaving the active
mapping untouched.

---

## Derived helpers and request building

The store module exports the domain constants and pure helpers that derive
request shape and button state from `form`:

| Helper | Location | What it derives |
|---|---|---|
| `SERVER_TYPE_BY_TARGET` | `frontend/src/hooks/useStore.ts:174-178` | target to server type: `cypher` to `neo4j`, `aql` to `arangodb`, `gremlin` to `gremlin` |
| `modesForTarget(options, target)` | `frontend/src/hooks/useStore.ts:184-186` | the validation modes valid for a target, from `options.validation_modes_by_target` |
| `usesThrowawayDb(form)` | `frontend/src/hooks/useStore.ts:191-196` | true when a `server`-mode run will fall back to the auto-provisioned throwaway DB: the target's primary connection field (`uri` for neo4j, `url` otherwise) is blank |
| `toDialect(d)` | `frontend/src/hooks/useStore.ts:274` | maps the UI sentinel `"generic"` to `null`; the backend and library only ever see a real sqlglot dialect name or null |
| `buildRequest(form)` | `frontend/src/hooks/useStore.ts:276-308` | the `TranslateRequest` sent by `translate()` |
| `canTranslate()` | `frontend/src/hooks/useStore.ts:445-461` | store action gating the Translate button |

`modesForTarget` falls back to the full `["none", "syntax", "server"]` set
in two cases: before `/api/options` has loaded, and against an older backend
that does not send the `validation_modes_by_target` map.

`buildRequest` sends `server_config: null` except for a `server`-mode run
with a filled primary connection field
(`frontend/src/hooks/useStore.ts:278-292`): in `server` mode with the
primary field blank (`usesThrowawayDb`) it stays null and the backend
provisions the throwaway DB; in `server` mode with a filled connection it
sends the connection typed by `SERVER_TYPE_BY_TARGET`; in `none` and
`syntax` modes it is always null. Empty strings become null
(`host`), and the numeric LLM fields treat 0 as "use the library default"
because an emptied-then-blurred input becomes 0; a null `max_iterations`
falls back to 3.

`canTranslate()` returns true only when no run is in flight, the SQL is
non-empty, the active mapping is valid (`mappingValidity.valid`), and both
live coverage lists are empty: the UI avoids spending a `translate()` call
on input the library's pre-flight gate would reject anyway. A parse failure
(`sqlParseOk === false`) is a warning, not a reject, so it does not gate.

---

## Debounced side-effect hooks

Four hooks, each wired exactly once in the root component
(`frontend/src/App.tsx:57-60`), debounce edits to a form field and then call
a store refresh action, which performs the fetch and writes the result back:

| Hook | Watches | Debounce | Endpoint | Writes |
|---|---|---|---|---|
| `useMappingValidation` (`frontend/src/hooks/useMappingValidation.ts:9`) | `form.mappingYaml` | 400 ms | `POST /api/validate-mapping` | `mappingValidity` |
| `useDraftMappingValidation` (`frontend/src/hooks/useDraftMappingValidation.ts:10`) | `form.draftMappingYaml` | 400 ms | `POST /api/validate-mapping` | `draftValidity` |
| `useFeatureDetection` (`frontend/src/hooks/useFeatureDetection.ts:9`) | `form.sql` | 400 ms | `POST /api/detect-features` | `features`, `sqlParseOk` |
| `useTableCoverage` (`frontend/src/hooks/useTableCoverage.ts:11`) | `form.sql`, `form.mappingYaml` | 400 ms | `POST /api/check-coverage` | `coverageUnmapped`, `coverageUnmappedColumns` |

The refresh actions (`frontend/src/hooks/useStore.ts:387-443`) soft-fail: an
empty input clears the derived state, and a failed request keeps the
previous value (features, coverage) or nulls the validity. Note that
`useFeatureDetection` and `useTableCoverage` do not watch `form.dialect`
even though the refresh actions send it, so a dialect change alone does not
re-run them until the next SQL or mapping edit. The endpoints themselves are
documented in [api.md](api.md). The written state drives the UI directly:
`mappingValidity` and `draftValidity` drive the mapping panes' validity
footers, `features` drives the feature chips, and `sqlParseOk` plus the
coverage lists drive the SQL pre-flight banner.

---

## Persistence and migration

The store persists to localStorage under the key `sql2graph-web` at
`version: 5` (`frontend/src/hooks/useStore.ts:640-641`). Only durable inputs
persist; `partialize` (`frontend/src/hooks/useStore.ts:669-676`) keeps
exactly `theme`, `leftOpen`, `rightOpen`, `view`, `sqlInner`, and `form`.
Everything else (options, validity, live pre-flight, `stream`, `build`, the
abort controllers) is rebuilt on load.

The version history, per the migrate comments
(`frontend/src/hooks/useStore.ts:642-650`):

| Version | Change | Migration |
|---|---|---|
| v0 | persisted a `mappingOpen` flag (the schema-mapping drawer) | key dropped |
| v2 | added `form.ddl` and `form.dialect` (the build inputs) | backfilled so a rehydrated older `form` is not missing keys |
| v3 | renamed the persisted `inputTab` to the top-level `view`; removed the short-lived `centerMode` | old `inputTab` value carried over to `view`; `centerMode` deleted |
| v4 | split the mapping into active `form.mappingYaml` + `form.draftMappingYaml`; added the SQL window's inner tab `sqlInner` | both backfilled (`draftMappingYaml: ""`, `sqlInner: "sql"`) |
| v5 | added `form.refineWithLlm` (the AI-refine toggle) | backfilled to `true`, preserving the previous always-refine behavior |

The `migrate` function (`frontend/src/hooks/useStore.ts:651-668`) is a
single idempotent normalization pass rather than a per-version chain: it
always drops the dead keys, carries `inputTab` over to `view`, and spreads
the persisted `form` over the newer fields' defaults, so a payload from any
older version rehydrates cleanly.
