"""Reads the library's own config dir so the UI's presets and defaults always
match the library.

- Schema-mapping presets come from ``sql2graph/examples/mappings/{tpch,ldbc}.yaml``
  (each paired with a sample SQL query so Translate works in one click).
- Model defaults come from ``sql2graph/config/models/{ollama,anthropic}.yaml``
  (loaded via the library's own ``load_model_config``), so editing those files is
  the single source of truth for the sidebar's model field.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, TypedDict

from sql2graph import AnthropicConfig, OllamaConfig, load_model_config


class Preset(TypedDict):
    name: str
    mapping_yaml: str
    sample_sql: str


_SAMPLE_SQL: dict[str, str] = {
    "tpch": "SELECT name, address, phone\nFROM supplier\nWHERE suppkey = 1337;",
    "ldbc": "SELECT id, first_name, last_name\nFROM person\nWHERE id = 933;",
}


def _config_dir() -> Path:
    override = os.environ.get("SQL2GRAPH_CONFIG_DIR")
    if override:
        return Path(override)
    # app/presets.py -> app -> backend -> sql2graph-web -> school/sql2graph
    return Path(__file__).resolve().parents[3] / "sql2graph" / "config"


def _examples_dir() -> Path:
    override = os.environ.get("SQL2GRAPH_EXAMPLES_DIR")
    if override:
        return Path(override)
    # app/presets.py -> app -> backend -> sql2graph-web -> school/sql2graph
    return Path(__file__).resolve().parents[3] / "sql2graph" / "examples"


def load_presets() -> list[Preset]:
    base = _examples_dir() / "mappings"
    presets: list[Preset] = []
    for name in ("tpch", "ldbc"):
        path = base / f"{name}.yaml"
        if path.is_file():
            presets.append(
                Preset(name=name, mapping_yaml=path.read_text(), sample_sql=_SAMPLE_SQL.get(name, ""))
            )
    return presets


def load_model_defaults() -> dict[str, dict[str, Any]]:
    """Default model settings per provider, sourced from the library's example
    model configs. Falls back to the library's own class defaults if a file is
    missing or fails to load (e.g. an unset interpolated env var)."""
    models_dir = _config_dir() / "models"
    defaults: dict[str, dict[str, Any]] = {}
    for name, cls in (("ollama", OllamaConfig), ("anthropic", AnthropicConfig)):
        path = models_dir / f"{name}.yaml"
        try:
            cfg = load_model_config(path) if path.is_file() else cls()
        except Exception:  # noqa: BLE001 - any load/validation issue -> safe class defaults
            cfg = cls()
        defaults[name] = cfg.model_dump()
    return defaults
