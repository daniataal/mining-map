"""
GEM Global Oil Infrastructure Tracker — Oil/NGL pipelines ingest.

Joins ``GEM-GOIT-Oil-NGL-Pipelines-2025-03.xlsx`` (attributes) with per-ProjectID
route GeoJSON from GOIT-GGIT-pipeline-routes into ``gem_pipeline_segments``.

License: CC BY 4.0 — Global Energy Monitor, March 2025 release.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

try:
    import pandas as pd
except ImportError:  # pragma: no cover
    pd = None  # type: ignore

try:
    from backend.services.gem_pipeline_segments import (
        SOURCE_ID,
        ensure_gem_pipeline_tables,
    )
except ImportError:
    from services.gem_pipeline_segments import (  # type: ignore
        SOURCE_ID,
        ensure_gem_pipeline_tables,
    )

def _clean_text(value: Any) -> Optional[str]:
    if value is None or (pd is not None and pd.isna(value)):
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return text

SOURCE_NAME = "GEM Global Oil Infrastructure Tracker — Oil/NGL Pipelines (March 2025)"
SOURCE_URL = "https://globalenergymonitor.org/projects/global-oil-infrastructure-tracker/"
PIPELINES_SHEET = "Pipelines"
DEFAULT_XLSX = "GEM-GOIT-Oil-NGL-Pipelines-2025-03.xlsx"
ROUTES_SUBDIR = Path("data") / "individual-files"

REPO_ROOT = Path(__file__).resolve().parents[3]


def default_workbook_path() -> Path:
    override = (os.getenv("GEM_GOIT_PIPELINES_XLSX_PATH") or "").strip()
    if override:
        return Path(override).expanduser()
    return REPO_ROOT / DEFAULT_XLSX


def default_routes_dir() -> Path:
    override = (os.getenv("GEM_GOIT_ROUTES_DIR") or "").strip()
    if override:
        return Path(override).expanduser()
    root = REPO_ROOT / "data" / "gem" / "goit-pipeline-routes"
    candidates = [
        root / "data" / "individual-routes" / "liquid-pipelines",
        root / "data" / "individual-files",
    ]
    for path in candidates:
        if path.is_dir() and any(path.glob("*.geojson")):
            return path
    return candidates[0]


def gem_goit_auto_ingest_enabled() -> bool:
    return (os.getenv("GEM_GOIT_PIPELINES_AUTO_INGEST") or "").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _safe_str(value: Any) -> Optional[str]:
    if value is None or (pd is not None and pd.isna(value)):
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return text


def _parse_float(value: Any) -> Optional[float]:
    cleaned = _safe_str(value)
    if not cleaned:
        return None
    cleaned = cleaned.replace(",", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def classify_fuel_group(fuel: Optional[str]) -> str:
    text = (fuel or "").lower()
    if not text:
        return "other"
    if "ngl" in text or "lpg" in text:
        return "ngl"
    if "gas" in text and "oil" not in text:
        return "gas"
    if "oil" in text or "crude" in text or "petroleum" in text:
        return "oil"
    return "other"


def _capacity_text(row: dict[str, Any]) -> Optional[str]:
    cap = _safe_str(row.get("Capacity"))
    units = _safe_str(row.get("CapacityUnits"))
    if cap and units:
        return f"{cap} {units}"
    return cap or units


def _segment_key(project_id: str, row_index: int, segment_name: Optional[str]) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", (segment_name or "")[:40]).strip("_").lower()
    if slug:
        return f"{project_id}:{row_index}:{slug}"
    return f"{project_id}:{row_index}"


def _row_dict(row: Any) -> dict[str, Any]:
    if isinstance(row, dict):
        return {str(k): v for k, v in row.items()}
    return {str(k): row[k] for k in row.index}  # type: ignore[attr-defined]


def normalize_row_tags(row: dict[str, Any], row_index: int) -> Optional[dict[str, Any]]:
    project_id = _clean_text(row.get("ProjectID"))
    if not project_id:
        return None
    pipeline_name = _clean_text(row.get("PipelineName"))
    segment_name = _clean_text(row.get("SegmentName"))
    fuel = _clean_text(row.get("Fuel"))
    status = _clean_text(row.get("Status")) or "unknown"
    return {
        "segment_key": _segment_key(project_id, row_index, segment_name),
        "project_id": project_id,
        "pipeline_name": pipeline_name,
        "segment_name": segment_name,
        "fuel": fuel,
        "fuel_group": classify_fuel_group(fuel),
        "status": status.lower(),
        "owner": _clean_text(row.get("Owner")),
        "parent": _clean_text(row.get("Parent")),
        "owner_entity_ids": _clean_text(row.get("OwnerEntityIDs")),
        "capacity_text": _capacity_text(row),
        "capacity_boed": _parse_float(row.get("CapacityBOEd")),
        "length_km": _parse_float(row.get("LengthMergedKm"))
        or _parse_float(row.get("LengthKnownKm"))
        or _parse_float(row.get("LengthEstimateKm")),
        "diameter": _clean_text(row.get("Diameter")),
        "diameter_units": _clean_text(row.get("DiameterUnits")),
        "countries": _clean_text(row.get("Countries")),
        "start_location": _clean_text(row.get("StartLocation")),
        "start_country": _clean_text(row.get("StartCountry")),
        "end_location": _clean_text(row.get("EndLocation")),
        "end_country": _clean_text(row.get("EndCountry")),
        "wiki": _clean_text(row.get("Wiki")),
        "route_type": _clean_text(row.get("RouteType")),
        "route_accuracy": _clean_text(row.get("RouteAccuracy")),
        "last_updated": _safe_str(row.get("LastUpdated")),
        "source_id": SOURCE_ID,
        "source_name": SOURCE_NAME,
        "source_url": SOURCE_URL,
        "name": pipeline_name or segment_name or project_id,
    }


def _extract_geometries(geo: dict[str, Any]) -> list[dict[str, Any]]:
    """Return list of GeoJSON geometry dicts (LineString or MultiLineString)."""
    out: list[dict[str, Any]] = []
    gtype = geo.get("type")
    if gtype == "FeatureCollection":
        for feat in geo.get("features") or []:
            if isinstance(feat, dict):
                out.extend(_extract_geometries(feat))
        return out
    if gtype == "Feature":
        geom = geo.get("geometry")
        if isinstance(geom, dict):
            out.extend(_extract_geometries(geom))
        return out
    if gtype in ("LineString", "MultiLineString"):
        coords = geo.get("coordinates")
        if not coords:
            return out
        if gtype == "LineString" and len(coords) >= 2:
            out.append(geo)
        elif gtype == "MultiLineString":
            if any(isinstance(line, list) and len(line) >= 2 for line in coords):
                out.append(geo)
    return out


def _load_project_geometry(routes_dir: Path, project_id: str) -> Optional[dict[str, Any]]:
    path = routes_dir / f"{project_id}.geojson"
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    geoms = _extract_geometries(payload)
    if not geoms:
        return None
    lines: list[list] = []
    for g in geoms:
        if g.get("type") == "LineString":
            lines.append(g["coordinates"])
        elif g.get("type") == "MultiLineString":
            lines.extend(g.get("coordinates") or [])
    if not lines:
        return None
    if len(lines) == 1:
        return {"type": "LineString", "coordinates": lines[0]}
    return {"type": "MultiLineString", "coordinates": lines}


def _read_pipelines_sheet(path: Path) -> list[dict[str, Any]]:
    if pd is None:
        raise RuntimeError("pandas is required for GEM GOIT ingest (pip install pandas openpyxl)")
    engine = "openpyxl" if path.suffix.lower() == ".xlsx" else None
    df = pd.read_excel(path, sheet_name=PIPELINES_SHEET, engine=engine)
    rows: list[dict[str, Any]] = []
    for idx, row in df.iterrows():
        row_dict = _row_dict(row)
        tags = normalize_row_tags(row_dict, int(idx) + 2)
        if tags:
            rows.append(tags)
    return rows


def upsert_segments(conn: Any, segments: list[tuple[str, str, dict[str, Any], dict[str, Any]]]) -> int:
    """segments: (segment_key, project_id, tags, geometry dict)."""
    ensure_gem_pipeline_tables(conn)
    written = 0
    fetched_at = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        for segment_key, project_id, tags, geom in segments:
            geom_json = json.dumps(geom)
            tags_json = json.dumps(tags)
            cur.execute(
                """
                INSERT INTO gem_pipeline_segments (segment_key, project_id, geom, tags, fetched_at)
                VALUES (
                    %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                    %s::jsonb,
                    %s
                )
                ON CONFLICT (segment_key) DO UPDATE SET
                    project_id = EXCLUDED.project_id,
                    geom = EXCLUDED.geom,
                    tags = EXCLUDED.tags,
                    fetched_at = EXCLUDED.fetched_at;
                """,
                (segment_key, project_id, geom_json, tags_json, fetched_at),
            )
            written += 1
    return written


def ingest_gem_goit_pipelines(
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
            "reason": f"workbook not found: {xlsx}",
            "source_id": SOURCE_ID,
        }
    if not routes.is_dir():
        return {
            "status": "skipped",
            "reason": f"routes directory not found: {routes} (run scripts/fetch_gem_goit_pipeline_routes.sh)",
            "source_id": SOURCE_ID,
        }

    rows = _read_pipelines_sheet(xlsx)
    geo_cache: dict[str, Optional[dict[str, Any]]] = {}
    to_write: list[tuple[str, str, dict[str, Any], dict[str, Any]]] = []
    skipped_no_geom = 0
    skipped_no_route_file = 0

    for tags in rows:
        project_id = tags["project_id"]
        if project_id not in geo_cache:
            geo_cache[project_id] = _load_project_geometry(routes, project_id)
        geom = geo_cache[project_id]
        if geom is None:
            if (routes / f"{project_id}.geojson").is_file():
                skipped_no_geom += 1
            else:
                skipped_no_route_file += 1
            continue
        to_write.append((tags["segment_key"], project_id, tags, geom))

    written = upsert_segments(conn, to_write) if to_write else 0

    return {
        "status": "ok",
        "source_id": SOURCE_ID,
        "workbook": xlsx.name,
        "routes_dir": str(routes),
        "rows_parsed": len(rows),
        "rows_with_geometry": len(to_write),
        "rows_upserted": written,
        "skipped_empty_geometry": skipped_no_geom,
        "skipped_missing_route_file": skipped_no_route_file,
        "unique_projects_with_geom": len({t[1] for t in to_write}),
    }


def try_auto_ingest_gem_goit_pipelines(
    conn: Any,
    *,
    workbook_path: Optional[str | Path] = None,
    routes_dir: Optional[str | Path] = None,
) -> dict[str, Any]:
    if not gem_goit_auto_ingest_enabled():
        return {"status": "skipped", "reason": "GEM_GOIT_PIPELINES_AUTO_INGEST is off"}
    if not default_workbook_path().is_file():
        return {"status": "skipped", "reason": "GEM GOIT workbook not present"}
    return ingest_gem_goit_pipelines(conn, workbook_path=workbook_path, routes_dir=routes_dir)


def get_source_registry_entry() -> dict[str, Any]:
    return {
        "source_kind": "global_open_fallback",
        "source_access": "open_reference_dataset",
        "coverage_state": "global_fallback_only",
        "provenance_note": (
            "GEM Global Oil Infrastructure Tracker — Oil/NGL pipelines (March 2025). "
            "CC BY 4.0; routes from GOIT-GGIT-pipeline-routes GeoJSON joined to spreadsheet attributes."
        ),
        "coverage_scope": "global_reference",
        "jurisdiction_scope": "global_reference",
        "jurisdiction_label": None,
        "note": "Transmission pipeline routes and throughput metadata; not tank storage capacity.",
    }
