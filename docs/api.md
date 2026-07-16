# API reference

**Every REST route the FastAPI backend serves under `/api`: request models,
response shapes, and the exact preconditions that fail fast.**

## Scope

This page owns REST semantics: routes, request bodies, response payloads, and
HTTP status behavior. Bordering topics live with their owners:

- [streaming.md](streaming.md): the SSE event vocabulary and lifecycle behind
  the two streaming endpoints.
- [errors.md](errors.md): failure channels across the stack (HTTP 4xx,
  fail-soft payloads, in-stream errors).
- [types.md](types.md): the backend/frontend type mirror these payloads are
  typed against.

---

## Conventions

- All routes are mounted under the `/api` prefix (`backend/app/api.py:36`);
  the frontend hardcodes the same relative prefix, so development goes through
  the Vite proxy and production is same-origin (see [install.md](install.md)).
- POST bodies are JSON, validated by the Pydantic request models in
  `backend/app/models.py`; a body that fails model validation gets FastAPI's
  standard 422 response.
- The two SSE endpoints surface invalid configuration as HTTP 400 before any
  stream starts, so a client never has to parse a broken stream to learn its
  request was bad; the full failure-channel matrix is in
  [errors.md](errors.md).

---

## Endpoint summary

The route table, moved here from the [project README](../README.md):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness probe (`{"status": "ok"}`). |
| GET | `/api/options` | Enums, library defaults, per-target valid modes, server-config defaults, and throwaway-DB availability, for building the forms. |
| GET | `/api/presets` | Bundled tpch/ldbc mappings plus sample SQL (backend only; the current UI does not auto-load them). |
| POST | `/api/validate-mapping` | Validate a mapping YAML string; returns `{valid, errors, node_count, edge_count, graph}`. |
| POST | `/api/build-mapping-stream` | SSE: stream the LLM naming conversation, then a `done` event carrying a schema mapping built from `CREATE TABLE` DDL. |
| POST | `/api/detect-features` | The SQL features the translator detects, plus `parse_ok` (drives the feature chips). |
| POST | `/api/check-coverage` | Live pre-flight: SQL tables/columns absent from the mapping (`unmapped_tables`, `unmapped_columns`, `parse_ok`). |
| POST | `/api/translate` | SSE stream of a translation run; the event vocabulary lives in [streaming.md](streaming.md). |

---

## The GET endpoints

### GET /api/health

Returns `{"status": "ok"}` unconditionally (`backend/app/api.py:66-68`). The
Docker deployment polls it as the container health check (`Dockerfile:75`,
`docker-compose.yml:34-35`).

### GET /api/options

One JSON object assembled by `options()` (`backend/app/api.py:71-99`),
carrying everything the settings forms need. Every enum is imported from the
library at import time, so the payload cannot drift from the installed
`sql2graph` version; the frontend's compile-time mirror of these values is
[types.md](types.md)'s topic.

| Field | Contents | Source |
|---|---|---|
| `providers` | `["ollama", "anthropic"]` | library `VALID_PROVIDERS` (`backend/app/api.py:78`) |
| `targets` | `["cypher", "aql", "gremlin"]` | `VALID_TARGETS` (`backend/app/api.py:79`) |
| `validation_modes` | `["none", "syntax", "server"]` | `VALID_VALIDATION_MODES` (`backend/app/api.py:80`) |
| `validation_modes_by_target` | map from each target to its allowed modes; the frontend offers only these | `valid_modes_for_target` per target (`backend/app/api.py:83`) |
| `defaults.anthropic`, `defaults.ollama` | per-provider model-field defaults | the library's example configs `config/models/{anthropic,ollama}.yaml`, loaded via the library's own `load_model_config`; class defaults on any load failure (`backend/app/presets.py:60-73`) |
| `defaults.max_iterations` | `3` | literal (`backend/app/api.py:87`) |
| `server_defaults.{neo4j,arangodb,gremlin}` | field defaults of the library's server-config classes; required fields appear as `null` | `_defaults()` reflection over the Pydantic models (`backend/app/api.py:39-45`, `backend/app/api.py:89-93`) |
| `target_server_type` | the server type each target needs for `server` validation | library `TARGET_SERVER_TYPE` (`backend/app/api.py:95`) |
| `notifications_min_severity_options` | `["OFF", "INFORMATION", "WARNING"]` | mirrors `Neo4jConfig.notifications_min_severity` (`backend/app/api.py:97`) |
| `docker_available` | whether empty-config `server` validation (throwaway managed DB) should be offered | `_docker_available()` (`backend/app/api.py:98`) |

`_docker_available()` (`backend/app/api.py:48-63`) pings the Docker daemon
once per process: it is wrapped in `functools.lru_cache(maxsize=1)` so
`/api/options` stays cheap. The honest caveat: the flag goes stale. A daemon
started or stopped after the first call is not noticed until the backend
process restarts, so the UI's throwaway-DB gating can lag reality.

### GET /api/presets

Returns a list of `{name, mapping_yaml, sample_sql}` objects
(`backend/app/api.py:102-104`, `backend/app/presets.py:48-57`). The two
presets are the library's bundled `tpch` and `ldbc` example mappings, read
from `examples/mappings/{tpch,ldbc}.yaml` in the sibling checkout (or from
`SQL2GRAPH_EXAMPLES_DIR`, see [install.md](install.md)), each paired with a
hardcoded one-click sample query (`backend/app/presets.py:26-29`). A missing
file drops that preset silently. Backend-only for now: the current UI does
not auto-load presets.

---

## POST /api/validate-mapping

Body: `MappingBody`, a single `mapping_yaml: str` field
(`backend/app/models.py:77-78`). The handler runs the library's single parse
path, `SchemaMapping.from_yaml_string`, so the editor's inline validity
indicator cannot diverge from what `/api/translate` later accepts
(`backend/app/api.py:107-128`).

**Fail-soft:** invalid input is HTTP 200 with `valid: false` and populated
`errors`, never a 4xx. Two failure classes are distinguished: malformed YAML
(`yaml.YAMLError`) yields one `YAML parse error: ...` string; a structurally
invalid mapping (`pydantic.ValidationError`) yields one formatted string per
problem.

| Field | When valid | When invalid |
|---|---|---|
| `valid` | `true` | `false` |
| `errors` | `[]` | one human-readable string per problem |
| `node_count`, `edge_count` | counts from the parsed mapping | `0` |
| `graph` | `mapping.model_dump()`, the structured node/edge view | `null` |

The error formatting (`backend/app/api.py:131-160`) makes pydantic output
readable in the UI: `_format_validation_errors` strips the `Value error, ` and
`Assertion error, ` prefixes, and `_format_loc` renders locations compactly
(`('nodes', 0, 'label')` becomes `nodes[0].label`). Model-level validator
errors carry an empty location and keep just the message, so an
edge-reference failure reads `Edge 'X' references undefined source_node 'Y'`
rather than pydantic's raw form.

`graph` is only emitted when the mapping is valid; it is the data source for
the mapping visualization, so the frontend draws the node/edge diagram from
structured JSON instead of re-parsing YAML client-side.

---

## POST /api/detect-features and /api/check-coverage

Both are fail-soft JSON helpers that run the same analysis the translator's
pre-flight gate runs, so the UI can flag problems while the user types,
before Translate is clicked. How these results map onto the translator's
warn-versus-reject policies (parse failure warns; unmapped tables and columns
reject) is [errors.md](errors.md)'s topic.

### POST /api/detect-features

Body: `SqlBody` (`sql`, optional `dialect`; `backend/app/models.py:81-83`).
Handler: `backend/app/api.py:189-200`.

- Blank SQL short-circuits to `{"features": [], "parse_ok": true}` with no
  parse attempt.
- Otherwise `analyze_sql(sql, dialect=...)` runs and the response carries the
  sorted feature names (values of the library's `SqlFeature` enum,
  `../sql2graph/src/sql2graph/sql_features.py`) plus `parse_ok`.
- `parse_ok: false` powers the live "could not parse, will translate anyway"
  hint: the translator's default `parse_error_action` is warn, not reject.

### POST /api/check-coverage

Body: `CoverageBody` (`sql`, `mapping_yaml`, optional `dialect`;
`backend/app/models.py:86-89`). Handler: `backend/app/api.py:203-226`.
Returns `{unmapped_tables, unmapped_columns, parse_ok}` by running the
library's `find_unmapped_tables` and `find_unmapped_columns` over the parsed
SQL and mapping.

Fails soft in three ways rather than erroring: blank SQL returns empty lists
with `parse_ok: true`; unparseable SQL returns empty lists with
`parse_ok: false`; an invalid mapping returns empty lists with
`parse_ok: true` (the mapping editor's own `/api/validate-mapping` indicator
already reports YAML problems, so this endpoint stays quiet about them).

---

## The SSE endpoints

`/api/translate` and `/api/build-mapping-stream` share one contract: invalid
input is rejected as HTTP 400 with a `detail` string before any stream opens;
once streaming starts, everything (including failures) arrives as events.
Stream behavior, the event vocabulary, coalescing, and disconnect handling
are [streaming.md](streaming.md)'s topic.

### POST /api/translate

Body: `TranslateRequest` (`backend/app/models.py:66-74`).

| Field | Type | Default | Notes |
|---|---|---|---|
| `target` | one of `cypher`, `aql`, `gremlin` | required | target query language |
| `mapping_yaml` | string | required | schema mapping YAML, parsed by the library's `SchemaMapping.from_yaml_string` |
| `sql` | string | required | the SQL to translate |
| `dialect` | string or null | `null` | sqlglot dialect for pre-flight parsing only (`parse_ok`, table/column coverage); never enters the prompt |
| `llm` | `LlmSettings` | required | see below |
| `validation` | `ValidationSettings` | required | see below |

`LlmSettings` (`backend/app/models.py:24-39`) mirrors the LLM sidebar.
Cross-provider fields are optional; fields left `null` are dropped before the
library config is built, so the library's `extra="forbid"` configs keep their
own defaults (`backend/app/library.py:37-40`, `backend/app/library.py:67-93`).

| Field | Type | Default | Applies to |
|---|---|---|---|
| `provider` | `ollama` or `anthropic` | required | both |
| `model` | string | required | both |
| `temperature` | float | `0.1` | both |
| `max_retries` | int, at least 0 | `3` | both |
| `num_ctx` | int or null | `null` | Ollama only (context window) |
| `host` | string or null | `null` | Ollama only; `null` falls back to `OLLAMA_HOST` on the backend |
| `repeat_penalty` | float or null | `null` | Ollama only; values above 1.0 discourage the degenerate repeat loop |
| `max_output_tokens` | int or null | `null` | Anthropic only |

There is deliberately no `api_key` field: the Anthropic SDK reads
`ANTHROPIC_API_KEY` from the backend environment
(`backend/app/models.py:38-39`), so the key never transits the browser.

`ValidationSettings` (`backend/app/models.py:60-63`):

| Field | Type | Default | Notes |
|---|---|---|---|
| `mode` | one of `none`, `syntax`, `server` | required | must be valid for the target (see `validation_modes_by_target` in `/api/options`) |
| `max_iterations` | int, at least 1 | `3` | the generate-validate-fix loop budget |
| `server_config` | `ServerSettings` or null | `null` | only consulted when `mode` is `server` |

`ServerSettings` (`backend/app/models.py:42-57`): every connection field
except the required `type` discriminator is optional, so an empty form is
detectable. `mode: server` with neither `uri`
nor `url` filled resolves to the library's managed throwaway-DB path
(`backend/app/library.py:164-166`, `backend/app/library.py:188`); which
server type each target needs is published as `target_server_type` in
`/api/options`.

| Field | Consumed by | Notes |
|---|---|---|
| `type` | all | one of `neo4j`, `arangodb`, `gremlin` |
| `uri` | Neo4j | bolt URI |
| `database` | Neo4j, ArangoDB | database name (`backend/app/library.py:126-150`) |
| `notifications_min_severity` | Neo4j | `OFF`, `INFORMATION`, or `WARNING` |
| `url` | ArangoDB, Gremlin | HTTP or WebSocket endpoint |
| `traversal_source` | Gremlin | traversal source name |
| `username`, `password` | all | credentials |

HTTP 400 preconditions (`backend/app/api.py:229-239`); the handler wraps
`library.build_translator` and converts `ValidationError`, `ValueError`, and
`TypeError` into 400s:

| Precondition | Detail |
|---|---|
| `sql` is empty or whitespace | `SQL query is empty.` |
| `validation.mode` not available for the target | the allowed-modes message from `backend/app/library.py:173-178` |
| structurally invalid mapping (`pydantic.ValidationError`) | pydantic's message, from `SchemaMapping.from_yaml_string` (`backend/app/library.py:179`) |
| model or server config rejected by the library | the library's exception message (`backend/app/library.py:180-192`) |

One honest gap: YAML that does not parse at all raises `yaml.YAMLError`
(`../sql2graph/src/sql2graph/mapping.py:417-426`), which is not in the caught
set, so it surfaces as a server error rather than a 400; the inline
`/api/validate-mapping` indicator is the intended gate. Failure channels,
including this one, are cataloged in [errors.md](errors.md).

### POST /api/build-mapping-stream

Body: `BuildMappingBody` (`backend/app/models.py:92-105`). The mapping
structure is always derived deterministically from the DDL; `refine` only
controls the guarded LLM naming pass on top.

| Field | Type | Default | Notes |
|---|---|---|---|
| `ddl` | string | required | `CREATE TABLE` DDL |
| `dialect` | string or null | `null` | sqlglot dialect for parsing the DDL |
| `llm` | `LlmSettings` | required | same shape as `/api/translate`; always accepted (the form sends it) but ignored when `refine` is false |
| `refine` | bool | `true` | `true` runs the LLM naming pass and streams its conversation; `false` returns the deterministic draft with no model call |

HTTP 400 preconditions (`backend/app/api.py:163-186`):

| Precondition | Applies |
|---|---|
| `ddl` is empty or whitespace (`DDL is empty.`) | always |
| DDL fails `extract_schema_from_ddl` (`DdlParseError`) | always |
| `llm` fails `library.build_model_config` | only when `refine` is true; a deterministic build does not require a valid model config |
