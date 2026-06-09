"""
GEM Global Gas Infrastructure Tracker — gas transmission pipeline ingest.

Joins the GGIT workbook gas pipeline sheet with per-ProjectID route GeoJSON from
``GOIT-GGIT-pipeline-routes`` gas-pipelines routes into ``gem_pipeline_segments``.

License: CC BY 4.0 — Global Energy Monitor.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

try:
    import pandas as pd
except ImportError:  # pragma: no cover
    pd = None  # type: ignore

try:
    from backend.services.ingest.gem_goit_pipelines_import import (
        _load_project_geometry,
        normalize_row_tags,
        upsert_segments,
    )
except ImportError:
    from services.ingest.gem_goit_pipelines_import import (  # type: ignore
        _load_project_geometry,
        normalize_row_tags,
        upsert_segments,
    )

SOURCE_NAME = "GEM Global Gas Infrastructure Tracker — Gas Transmission (September 2025)"
SOURCE_URL = "https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/"
DEFAULT_XLSX = "Global-Gas-Infrastructure-Tracker-GGIT-September-2025.xlsx"
GAS_PIPELINES_SHEETS = ("Gas Pipelines", "Gas Transmission Pipelines", "Pipelines")
ROUTES_SUBDIR = Path("data") / "individual-routes" / "gas-pipelines"
REPO_ROOT = Path(__file__).resolve().parents[3]


def default_workbook_path() -> Path:
    override = (os.getenv("GEM_GGIT_XLSX_PATH") or "").strip()
    if override:
        return Path(override).expanduser()
    return REPO_ROOT / DEFAULT_XLSX


def default_routes_dir() -> Path:
    override = (os.getenv("GEM_GGIT_GAS_ROUTES_DIR") or "").strip()
    if override:
        return Path(override).expanduser()
    root = REPO_ROOT / "data" / "gem" / "goit-pipeline-routes"
    candidates = [
        root / "data" / "individual-routes" / "gas-pipelines",
        root / ROUTES_SUBDIR,
    ]
    for path in candidates:
        if path.is_dir() and any(path.glob("*.geojson")):
            return path
    return candidates[0]


def gem_ggit_gas_auto_ingest_enabled() -> bool:
    return (os.getenv("GEM_GGIT_GAS_PIPELINES_AUTO_INGEST") or "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _read_gas_pipelines_sheet(path: Path) -> list[dict[str, Any]]:
    if pd is None:
        raise RuntimeError("pandas is required for GEM GGIT gas ingest (pip install pandas openpyxl)")
    engine = "openpyxl" if path.suffix.lower() == ".xlsx" else None
    last_error: Exception | None = None
    for sheet in GAS_PIPELINES_SHEETS:
        try:
            df = pd.read_excel(path, sheet_name=sheet, engine=engine)
            rows: list[dict[str, Any]] = []
            for idx, row in df.iterrows():
                row_dict = {str(k): row[k] for k in row.index}
                tags = normalize_row_tags(row_dict, int(idx) + 2)
                if tags:
                    tags["source"] = "gem_ggit_gas_transmission_september_2025"
                    tags["layer_id"] = "gem_gas_pipelines"
                    tags["fuel_group"] = "gas"
                    tags["segment_key"] = f"ggit-gas:{tags['segment_key']}"
                    rows.append(tags)
            if rows:
                return rows
        except Exception as exc:  # pragma: no cover - sheet name varies by release
            last_error = exc
            continue
    if last_error:
        raise last_error
    return []


def ingest_gem_ggit_gas_pipelines(
    conn: Any,
    *,
    workbook_path: Optional[str | Path] = None,
    routes_dir: Optional[str | Path] = None,
) -> dict[str, Any]:
    xlsx = Path(workbook_path).expanduser() if workbook_path else default_workbook_path()
    routes = Path(routes_dir).expanduser() if routes_dir else default_routes_dir()
    if not xlsx.is_file():
        return {
            "status": "skipped",
            "reason": "workbook_missing",
            "workbook_path": str(xlsx),
        }

    rows = _read_gas_pipelines_sheet(xlsx)
    to_write: list[tuple[str, str, dict[str, Any], dict[str, Any]]] = []
    missing_routes: list[str] = []

    for tags in rows:
        project_id = tags.get("project_id")
        if not project_id:
            continue
        geom = _load_project_geometry(routes, str(project_id))
        if not geom:
            missing_routes.append(str(project_id))
            continue
        to_write.append((tags["segment_key"], str(project_id), tags, geom))

    written = upsert_segments(conn, to_write) if to_write else 0
    return {
        "status": "success",
        "source_name": SOURCE_NAME,
        "source_url": SOURCE_URL,
        "workbook_path": str(xlsx),
        "routes_dir": str(routes),
        "rows_read": len(rows),
        "segments_written": written,
        "missing_route_project_ids": missing_routes[:20],
        "missing_route_count": len(missing_routes),
    }


def try_auto_ingest_gem_ggit_gas_pipelines(
    conn: Any,
    *,
    workbook_path: Optional[str | Path] = None,
    routes_dir: Optional[str | Path] = None,
) -> dict[str, Any]:
    if not gem_ggit_gas_auto_ingest_enabled():
        return {"status": "skipped", "reason": "auto_ingest_disabled"}
    return ingest_gem_ggit_gas_pipelines(conn, workbook_path=workbook_path, routes_dir=routes_dir)
