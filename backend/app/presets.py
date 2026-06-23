"""Bundled schema-mapping presets, read from the library's own config dir.

We don't copy the YAML — we read ``rows2graph/config/mappings/{tpch,ldbc}.yaml``
so presets always match the library. Each preset also ships a matching sample SQL
query (drawn from the evaluation datasets) so Translate works in one click.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TypedDict


class Preset(TypedDict):
    name: str
    mapping_yaml: str
    sample_sql: str


_SAMPLE_SQL: dict[str, str] = {
    "tpch": "SELECT name, address, phone\nFROM supplier\nWHERE suppkey = 1337;",
    "ldbc": "SELECT id, first_name, last_name\nFROM person\nWHERE id = 933;",
}


def _mappings_dir() -> Path:
    override = os.environ.get("ROWS2GRAPH_CONFIG_DIR")
    if override:
        return Path(override)
    # app/presets.py -> app -> backend -> rows2graph-web -> school/rows2graph
    return Path(__file__).resolve().parents[3] / "rows2graph" / "config" / "mappings"


def load_presets() -> list[Preset]:
    base = _mappings_dir()
    presets: list[Preset] = []
    for name in ("tpch", "ldbc"):
        path = base / f"{name}.yaml"
        if path.is_file():
            presets.append(
                Preset(name=name, mapping_yaml=path.read_text(), sample_sql=_SAMPLE_SQL.get(name, ""))
            )
    return presets
