"""HTTP surface. Thin endpoints over the library + the SSE bridge."""

from __future__ import annotations

import logging
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError
from pydantic_core import PydanticUndefined
from rows2graph import (
    ArangoDBConfig,
    GremlinConfig,
    Neo4jConfig,
    SchemaMapping,
)
from rows2graph.sql_features import detect_features
from sse_starlette.sse import EventSourceResponse

from . import library, presets
from .bridge import stream
from .models import MappingBody, SqlBody, TranslateRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


def _defaults(model: type[BaseModel]) -> dict[str, Any]:
    """Default field values from a Pydantic model (required fields -> None)."""
    out: dict[str, Any] = {}
    for name, field in model.model_fields.items():
        default = field.default
        out[name] = None if default is PydanticUndefined else default
    return out


def _docker_available() -> bool:
    """Best-effort check so the UI can warn before empty-config 'server' mode."""
    try:
        import docker  # type: ignore[import-untyped]

        client = docker.from_env()
        client.ping()
        return True
    except Exception:  # noqa: BLE001
        return False


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/options")
def options() -> dict[str, Any]:
    """Enums + library defaults for building the forms, kept in sync with the
    library's own config models and example config files."""
    model_defaults = presets.load_model_defaults()
    return {
        "providers": ["ollama", "anthropic"],
        "targets": ["cypher", "aql", "gremlin"],
        "validation_modes": ["none", "syntax", "server"],
        "defaults": {
            "anthropic": model_defaults["anthropic"],
            "ollama": model_defaults["ollama"],
            "max_iterations": 3,
        },
        "server_defaults": {
            "neo4j": _defaults(Neo4jConfig),
            "arangodb": _defaults(ArangoDBConfig),
            "gremlin": _defaults(GremlinConfig),
        },
        # which server type each target needs for 'server' validation
        "target_server_type": {"cypher": "neo4j", "aql": "arangodb", "gremlin": "gremlin"},
        "notifications_min_severity_options": ["OFF", "INFORMATION", "WARNING"],
        "docker_available": _docker_available(),
    }


@router.get("/presets")
def get_presets() -> list[presets.Preset]:
    return presets.load_presets()


@router.post("/validate-mapping")
def validate_mapping(body: MappingBody) -> dict[str, Any]:
    """Parse + validate a mapping YAML string for the inline validity indicator."""
    try:
        data = yaml.safe_load(body.mapping_yaml)
    except yaml.YAMLError as exc:
        return {"valid": False, "errors": [f"YAML parse error: {exc}"], "node_count": 0, "edge_count": 0}
    if not isinstance(data, dict):
        return {"valid": False, "errors": ["Mapping must be a YAML mapping with 'nodes' and 'edges'."],
                "node_count": 0, "edge_count": 0}
    try:
        mapping = SchemaMapping.model_validate(data)
    except ValidationError as exc:
        errors = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()]
        return {"valid": False, "errors": errors, "node_count": 0, "edge_count": 0}
    return {"valid": True, "errors": [], "node_count": len(mapping.nodes), "edge_count": len(mapping.edges)}


@router.post("/detect-features")
def detect(body: SqlBody) -> dict[str, list[str]]:
    """The same SQL feature detection the translator runs internally."""
    if not body.sql.strip():
        return {"features": []}
    features = detect_features(body.sql)
    return {"features": sorted(f.value for f in features)}


@router.post("/translate")
async def translate(req: TranslateRequest) -> EventSourceResponse:
    """SSE streaming endpoint. Builds the translator (surfacing config errors as
    400 before streaming) then streams conversation + milestone events."""
    if not req.sql.strip():
        raise HTTPException(status_code=400, detail="SQL query is empty.")
    try:
        translator, effective_mode = library.build_translator(req)
    except (ValidationError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return EventSourceResponse(stream(translator, req.sql, effective_mode))
