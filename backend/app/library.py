"""Adapters: turn request JSON into rows2graph's own objects and components.

This is the only place that touches the library. It mirrors
``demo/cli.py:main()`` — same factories, same wiring — but builds inputs from the
HTTP request instead of argparse + YAML files.
"""

from __future__ import annotations

import os
from typing import Any

import yaml
from rows2graph import (
    AnthropicConfig,
    ArangoDBConfig,
    AsyncSQLTranslator,
    GremlinConfig,
    Neo4jConfig,
    OllamaConfig,
    SchemaMapping,
    make_async_llm,
    make_async_validator,
    make_target,
)

from .models import LlmSettings, ServerSettings, TranslateRequest

ModelConfig = AnthropicConfig | OllamaConfig
ServerConfig = Neo4jConfig | ArangoDBConfig | GremlinConfig


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    """Drop None values so the library's strict (extra='forbid') configs keep
    their own defaults instead of receiving an unexpected ``None``."""
    return {k: v for k, v in d.items() if v is not None}


def build_mapping(mapping_yaml: str) -> SchemaMapping:
    """Parse + validate a mapping YAML string. Equivalent to ``from_yaml`` but
    from a textarea rather than a file (the library's from_yaml is just
    ``safe_load`` + ``model_validate``)."""
    data = yaml.safe_load(mapping_yaml)
    return SchemaMapping.model_validate(data)


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
    validation mode (``server`` with an empty config resolves to ``managed`` —
    the same rule demo/cli.py applies)."""
    mapping = build_mapping(req.mapping_yaml)
    model_cfg = build_model_config(req.llm)

    mode = req.validation.mode
    server_cfg: ServerConfig | None = None
    if mode == "server" and req.validation.server_config is not None and not _server_is_empty(
        req.validation.server_config
    ):
        server_cfg = build_server_config(req.validation.server_config)
    effective_mode = "managed" if (mode == "server" and server_cfg is None) else mode

    llm = make_async_llm(model_cfg)
    target = make_target(req.target)
    validator = make_async_validator(req.target, effective_mode, server_config=server_cfg)
    translator = AsyncSQLTranslator(
        schema_mapping=mapping,
        llm=llm,
        target=target,
        validator=validator,
        max_iterations=req.validation.max_iterations,
    )
    return translator, effective_mode
