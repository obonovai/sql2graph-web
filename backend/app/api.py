"""HTTP surface. Thin endpoints over the library + the SSE bridge."""

from __future__ import annotations

import functools
import logging
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError
from pydantic_core import PydanticUndefined
from rows2graph import (
    TARGET_SERVER_TYPE,
    VALID_PROVIDERS,
    VALID_TARGETS,
    VALID_VALIDATION_MODES,
    ArangoDBConfig,
    GremlinConfig,
    Neo4jConfig,
    SchemaMapping,
    analyze_sql,
    valid_modes_for_target,
)
from rows2graph.preflight import find_unmapped_columns, find_unmapped_tables
from sse_starlette.sse import EventSourceResponse

from . import library, presets
from .bridge import stream
from .models import CoverageBody, MappingBody, SqlBody, TranslateRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


def _defaults(model: type[BaseModel]) -> dict[str, Any]:
    """Default field values from a Pydantic model (required fields -> None)."""
    out: dict[str, Any] = {}
    for name, field in model.model_fields.items():
        default = field.default
        out[name] = None if default is PydanticUndefined else default
    return out


@functools.lru_cache(maxsize=1)
def _docker_available() -> bool:
    """Best-effort check so the UI can warn before empty-config 'server' mode.

    Cached: the daemon ping runs once per process rather than on every
    ``/api/options`` request.
    """
    try:
        import docker  # type: ignore[import-untyped]

        client = docker.from_env()
        client.ping()
        return True
    except Exception:  # noqa: BLE001
        logger.info("Docker not available: empty-config 'server' validation will be disabled in the UI.")
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
        # Enums sourced from the library so they can't drift from it.
        "providers": list(VALID_PROVIDERS),
        "targets": list(VALID_TARGETS),
        "validation_modes": list(VALID_VALIDATION_MODES),
        # Per-target allowed modes (AQL has no deployment-free 'syntax' validator).
        # The frontend uses this to offer only valid modes for the chosen target.
        "validation_modes_by_target": {t: list(valid_modes_for_target(t)) for t in VALID_TARGETS},
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
        "target_server_type": dict(TARGET_SERVER_TYPE),
        # mirrors Neo4jConfig.notifications_min_severity
        "notifications_min_severity_options": ["OFF", "INFORMATION", "WARNING"],
        "docker_available": _docker_available(),
    }


@router.get("/presets")
def get_presets() -> list[presets.Preset]:
    return presets.load_presets()


@router.post("/validate-mapping")
def validate_mapping(body: MappingBody) -> dict[str, Any]:
    """Parse + validate a mapping YAML string for the inline validity indicator.

    Shares the library's single parse path (``SchemaMapping.from_yaml_string``) with
    the translate endpoint, so the indicator can't diverge from real validation.
    """
    try:
        mapping = SchemaMapping.from_yaml_string(body.mapping_yaml)
    except yaml.YAMLError as exc:
        return {"valid": False, "errors": [f"YAML parse error: {exc}"], "node_count": 0, "edge_count": 0}
    except ValidationError as exc:
        return {"valid": False, "errors": _format_validation_errors(exc), "node_count": 0, "edge_count": 0}
    return {"valid": True, "errors": [], "node_count": len(mapping.nodes), "edge_count": len(mapping.edges)}


# pydantic prefixes messages raised from a validator's ValueError/AssertionError; strip the noise.
_PYDANTIC_PREFIXES = ("Value error, ", "Assertion error, ")


def _format_loc(loc: tuple[Any, ...]) -> str:
    """Render a pydantic error location compactly: ('nodes', 0, 'label') -> 'nodes[0].label'."""
    out = ""
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out


def _format_validation_errors(exc: ValidationError) -> list[str]:
    """Human-readable mapping-validation errors for the UI.

    Drops pydantic's ``Value error,`` prefix and, for model-level validators (empty
    ``loc``), the otherwise-leading ``": "``, so an edge-reference failure reads
    ``Edge 'X' references undefined source_node 'Y'`` rather than
    ``: Value error, Edge 'X' references…``. Field errors keep a compact location.
    """
    msgs: list[str] = []
    for err in exc.errors():
        msg = err["msg"]
        for prefix in _PYDANTIC_PREFIXES:
            if msg.startswith(prefix):
                msg = msg[len(prefix) :]
                break
        loc = _format_loc(err["loc"])
        msgs.append(f"{loc}: {msg}" if loc else msg)
    return msgs


@router.post("/detect-features")
def detect(body: SqlBody) -> dict[str, Any]:
    """The same SQL analysis the translator runs internally.

    Returns the detected features plus ``parse_ok`` so the UI can show a live
    "couldn't parse, will translate anyway" warning as the user types (the
    translator's default ``parse_error_action`` is ``warn``).
    """
    if not body.sql.strip():
        return {"features": [], "parse_ok": True}
    analysis = analyze_sql(body.sql)
    return {"features": sorted(f.value for f in analysis.features), "parse_ok": analysis.parse_ok}


@router.post("/check-coverage")
def check_coverage(body: CoverageBody) -> dict[str, Any]:
    """Live pre-flight: which SQL tables/columns are absent from the mapping.

    Mirrors the translator's unmapped-tables (reject by default) and
    unmapped-columns (warn by default) checks so the UI can flag the problem
    before the user clicks Translate. Fails soft: an empty/unparseable SQL or an
    invalid mapping yields empty lists (the mapping editor's own
    ``/validate-mapping`` indicator reports YAML errors).
    """
    if not body.sql.strip():
        return {"unmapped_tables": [], "unmapped_columns": [], "parse_ok": True}
    analysis = analyze_sql(body.sql)
    if not analysis.parse_ok:
        return {"unmapped_tables": [], "unmapped_columns": [], "parse_ok": False}
    try:
        mapping = SchemaMapping.from_yaml_string(body.mapping_yaml)
    except (yaml.YAMLError, ValidationError):
        return {"unmapped_tables": [], "unmapped_columns": [], "parse_ok": True}
    return {
        "unmapped_tables": find_unmapped_tables(analysis.source_tables, mapping),
        "unmapped_columns": find_unmapped_columns(analysis.column_refs, mapping),
        "parse_ok": True,
    }


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
