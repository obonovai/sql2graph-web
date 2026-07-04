"""Pydantic request models for the web UI.

These mirror the shape of the sidebar/main-area form. The backend converts them
into the sql2graph library's own config objects in :mod:`app.library`; it adds
no translation logic of its own.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# These mirror sql2graph's VALID_PROVIDERS / VALID_TARGETS / VALID_VALIDATION_MODES
# and TARGET_SERVER_TYPE values. They stay spelled out here because a typing.Literal
# needs compile-time members (it can't be built from the library's runtime tuples);
# keep them in sync if the library's sets change.
Provider = Literal["ollama", "anthropic"]
Target = Literal["cypher", "aql", "gremlin"]
ValidationMode = Literal["none", "syntax", "server"]
ServerType = Literal["neo4j", "arangodb", "gremlin"]


class LlmSettings(BaseModel):
    """LLM sidebar settings. Cross-provider fields are optional and dropped per
    provider before building the library config (which forbids extra fields)."""

    provider: Provider
    model: str
    temperature: float = 0.1
    max_retries: int = Field(default=3, ge=0)
    # Ollama only:
    num_ctx: int | None = None
    host: str | None = None  # falls back to OLLAMA_HOST env on the backend
    repeat_penalty: float | None = None  # >1.0 discourages the degenerate repeat loop
    # Anthropic only:
    max_output_tokens: int | None = None
    # api_key is intentionally absent: the Anthropic SDK reads ANTHROPIC_API_KEY
    # from the backend environment.


class ServerSettings(BaseModel):
    """Optional server-validation connection. All fields optional so an empty
    form is detectable: empty + mode=='server' means "auto-provision a throwaway
    database" (the library's managed path)."""

    type: ServerType
    # neo4j
    uri: str | None = None
    database: str | None = None
    notifications_min_severity: Literal["OFF", "INFORMATION", "WARNING"] | None = None
    # arangodb / gremlin
    url: str | None = None
    traversal_source: str | None = None
    # shared
    username: str | None = None
    password: str | None = None


class ValidationSettings(BaseModel):
    mode: ValidationMode
    max_iterations: int = Field(default=3, ge=1)
    server_config: ServerSettings | None = None


class TranslateRequest(BaseModel):
    target: Target
    mapping_yaml: str
    sql: str
    # sqlglot dialect for parsing the input SQL in pre-flight (parse_ok +
    # table/column coverage); None = dialect-neutral. Never enters the prompt.
    dialect: str | None = None
    llm: LlmSettings
    validation: ValidationSettings


class MappingBody(BaseModel):
    mapping_yaml: str


class SqlBody(BaseModel):
    sql: str
    dialect: str | None = None


class CoverageBody(BaseModel):
    sql: str
    mapping_yaml: str
    dialect: str | None = None


class BuildMappingBody(BaseModel):
    """Request for generating a schema mapping from CREATE TABLE DDL.

    The structure is always derived deterministically. When ``refine`` is true the LLM
    naming pass additionally runs, reusing the same ``llm`` settings (and backend
    environment) as translation; when false the deterministic draft is returned as-is
    with no model call. ``llm`` is always accepted (the form sends it) but ignored when
    ``refine`` is false.
    """

    ddl: str
    dialect: str | None = None
    llm: LlmSettings
    refine: bool = True
