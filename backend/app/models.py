"""Pydantic request models for the web UI.

These mirror the shape of the sidebar/main-area form. The backend converts them
into the rows2graph library's own config objects in :mod:`app.library` — it adds
no translation logic of its own.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# These mirror rows2graph's VALID_PROVIDERS / VALID_TARGETS / VALID_VALIDATION_MODES
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
    # api_key is intentionally absent — the Anthropic SDK reads ANTHROPIC_API_KEY
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
    llm: LlmSettings
    validation: ValidationSettings


class MappingBody(BaseModel):
    mapping_yaml: str


class SqlBody(BaseModel):
    sql: str


class CoverageBody(BaseModel):
    sql: str
    mapping_yaml: str
