"""Adapters: turn request JSON into sql2graph's own objects and components.

This is the only place that touches the library. It uses the library's own
factories and wiring but builds inputs from the HTTP request instead of
local YAML files.
"""

from __future__ import annotations

import os
from typing import Any

from sql2graph import (
    AnthropicConfig,
    ArangoDBConfig,
    AsyncSQLTranslator,
    BuildResult,
    ConversationCallback,
    GremlinConfig,
    Neo4jConfig,
    OllamaConfig,
    SchemaMapping,
    build_mapping_async,
    make_async_llm,
    make_async_validator,
    make_target,
    resolve_validation_mode,
    valid_modes_for_target,
)

from .models import LlmSettings, ServerSettings, TranslateRequest

ModelConfig = AnthropicConfig | OllamaConfig
ServerConfig = Neo4jConfig | ArangoDBConfig | GremlinConfig


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    """Drop None values so the library's strict (extra='forbid') configs keep
    their own defaults instead of receiving an unexpected ``None``."""
    return {k: v for k, v in d.items() if v is not None}


def _build_result_to_dict(result: BuildResult) -> dict[str, Any]:
    """Shape a library :class:`BuildResult` into the JSON the build endpoint returns.

    ``graph`` is the structured node/edge view (the same shape as ``SchemaMapping``)
    so the web UI can draw the mapping without a YAML parser. The deterministic
    "skeleton" and the rename ``diff`` are intentionally omitted: the modal always
    applies the AI-refined result and no longer compares the two versions."""
    return {
        "mapping_yaml": result.yaml,
        "graph": result.mapping.model_dump(),
        "report": result.report.as_dict(),
        "warnings": result.warnings,
        "refined": result.refined,
        "conversation": result.conversation,
    }


def build_model_config(llm: LlmSettings) -> ModelConfig:
    """Build the provider-specific LLM config (Anthropic or Ollama) from the form,
    dropping unset fields so the library keeps its own defaults."""
    if llm.provider == "anthropic":
        return AnthropicConfig(
            **_clean(
                {
                    "model": llm.model,
                    "temperature": llm.temperature,
                    "max_output_tokens": llm.max_output_tokens,
                    "max_retries": llm.max_retries,
                }
            )
        )
    host = llm.host or os.environ.get("OLLAMA_HOST")
    return OllamaConfig(
        **_clean(
            {
                "model": llm.model,
                "host": host,
                "temperature": llm.temperature,
                "num_ctx": llm.num_ctx,
                "repeat_penalty": llm.repeat_penalty,
                "max_retries": llm.max_retries,
            }
        )
    )


async def build_mapping_from_ddl_async(
    ddl: str,
    *,
    dialect: str | None = None,
    llm: LlmSettings,
    on_conversation: ConversationCallback | None = None,
) -> dict[str, Any]:
    """Generate a schema-mapping draft from CREATE TABLE DDL via the library.

    The structure is derived deterministically and an LLM always improves the
    node/edge names, running through the same model factory as translation (and the
    same backend env, e.g. ``ANTHROPIC_API_KEY``). That pass is guarded by the
    library, so a failed refinement simply returns the deterministic mapping with a
    warning. Its conversation is streamed via *on_conversation* (the SSE bridge
    consumes it). Raises the library's ``DdlParseError`` (a ``ValueError``) on
    unparseable DDL, which the API surfaces as HTTP 400.
    """
    client = make_async_llm(build_model_config(llm))
    try:
        result = await build_mapping_async(ddl=ddl, dialect=dialect, llm=client, on_conversation=on_conversation)
    finally:
        await client.close()
    return _build_result_to_dict(result)


def build_server_config(sc: ServerSettings) -> ServerConfig:
    """Build the target-specific server-validation config (Neo4j / ArangoDB /
    Gremlin) from the connection form."""
    if sc.type == "neo4j":
        return Neo4jConfig(
            **_clean(
                {
                    "uri": sc.uri,
                    "username": sc.username,
                    "password": sc.password,
                    "database": sc.database,
                    "notifications_min_severity": sc.notifications_min_severity,
                }
            )
        )
    if sc.type == "arangodb":
        return ArangoDBConfig(
            **_clean(
                {
                    "url": sc.url,
                    "username": sc.username,
                    "password": sc.password,
                    "database": sc.database,
                }
            )
        )
    return GremlinConfig(
        **_clean(
            {
                "url": sc.url,
                "traversal_source": sc.traversal_source,
                "username": sc.username,
                "password": sc.password,
            }
        )
    )


def _server_is_empty(sc: ServerSettings) -> bool:
    """A server form with no primary endpoint filled means "use a throwaway DB"."""
    return not (sc.uri or sc.url)


def build_translator(req: TranslateRequest) -> tuple[AsyncSQLTranslator, str]:
    """Construct the translator from the request, returning it plus the effective
    validation mode (``server`` with an empty config resolves to ``managed``,
    the library's standard resolution rule)."""
    if req.validation.mode not in valid_modes_for_target(req.target):
        allowed = ", ".join(valid_modes_for_target(req.target))
        raise ValueError(
            f"Validation mode '{req.validation.mode}' is not available for target "
            f"'{req.target}' (available: {allowed})."
        )
    mapping = SchemaMapping.from_yaml_string(req.mapping_yaml)
    model_cfg = build_model_config(req.llm)

    mode = req.validation.mode
    server_cfg: ServerConfig | None = None
    if mode == "server" and req.validation.server_config is not None and not _server_is_empty(
        req.validation.server_config
    ):
        server_cfg = build_server_config(req.validation.server_config)
    effective_mode = resolve_validation_mode(mode, server_config=server_cfg)

    llm = make_async_llm(model_cfg)
    target = make_target(req.target)
    validator = make_async_validator(req.target, effective_mode, server_config=server_cfg)
    translator = AsyncSQLTranslator(
        schema_mapping=mapping,
        llm=llm,
        target=target,
        validator=validator,
        max_iterations=req.validation.max_iterations,
        dialect=req.dialect,
    )
    return translator, effective_mode
