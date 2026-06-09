"""Persisted GEM GOIT oil/NGL pipeline segments — map GeoJSON API."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

SOURCE_ID = "gem_goit_oil_ngl_pipelines_march_2025"
LAYER_LABEL = "Oil/NGL pipelines — GEM GOIT"
ATTRIBUTION = "© Global Energy Monitor (CC BY 4.0)"
LICENSE_NOTE = (
    "Global Oil Infrastructure Tracker — Oil/NGL Pipelines, March 2025 release. "
    "Community NGO research; routes may be approximate."
)
LIMITATIONS = [
    "Routes are compiled by Global Energy Monitor; not official government pipeline cadastre.",
    "Attributes come from the GOIT spreadsheet; geometry from per-ProjectID GeoJSON files.",
    "Does not replace OpenStreetMap pipeline layers — use both with separate attribution.",
]

DEFAULT_BBOX_LIMIT = 5000


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ensure_gem_pipeline_tables(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS gem_pipeline_segments (
                id BIGSERIAL PRIMARY KEY,
                segment_key TEXT NOT NULL UNIQUE,
                project_id TEXT NOT NULL,
                geom GEOMETRY(Geometry, 4326) NOT NULL,
                tags JSONB NOT NULL DEFAULT '{}'::jsonb,
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_gem_pipeline_segments_project
            ON gem_pipeline_segments (project_id);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_gem_pipeline_segments_geom
            ON gem_pipeline_segments USING GIST (geom);
            """
        )


def segment_stats(conn: Any) -> dict[str, Any]:
    ensure_gem_pipeline_tables(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM gem_pipeline_segments;")
        total = int(cur.fetchone()[0] or 0)
        cur.execute("SELECT MAX(fetched_at) FROM gem_pipeline_segments;")
        last = cur.fetchone()[0]
    return {
        "feature_count": total,
        "last_fetched_at": last.isoformat() if last else None,
    }


def get_gem_pipelines_geojson(
    conn: Any,
    *,
    bbox: Optional[tuple[float, float, float, float]] = None,
    zoom: Optional[float] = None,
    limit: int = DEFAULT_BBOX_LIMIT,
) -> dict[str, Any]:
    ensure_gem_pipeline_tables(conn)
    stats = segment_stats(conn)
    if stats["feature_count"] == 0:
        return _empty_response(bbox=bbox, coverage_gap=True, hint="run POST /api/admin/gem-goit-pipelines/ingest")

    try:
        from backend.services.license_map_perf import simplify_tolerance_for_zoom
    except ImportError:
        from services.license_map_perf import simplify_tolerance_for_zoom

    tolerance = simplify_tolerance_for_zoom(zoom)
    select_params: list[Any] = []
    where_params: list[Any] = []
    bbox_clause = ""
    if bbox is not None:
        south, west, north, east = bbox
        bbox_clause = """
            AND ST_Intersects(
                geom,
                ST_MakeEnvelope(%s, %s, %s, %s, 4326)
            )
        """
        where_params.extend([west, south, east, north])

    if tolerance > 0:
        geom_sql = "ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom::geometry, %s))::json"
        select_params.append(tolerance)
    else:
        geom_sql = "ST_AsGeoJSON(geom)::json"

    row_limit = max(1, min(limit, 20000))

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT segment_key, project_id, tags, {geom_sql}
            FROM gem_pipeline_segments
            WHERE 1=1
            {bbox_clause}
            ORDER BY project_id, segment_key
            LIMIT %s;
            """,
            tuple([*select_params, *where_params, row_limit]),
        )
        rows = cur.fetchall()

    features: list[dict[str, Any]] = []
    for segment_key, project_id, tags_raw, geom_json in rows:
        tags = tags_raw if isinstance(tags_raw, dict) else {}
        if isinstance(tags_raw, str):
            try:
                tags = json.loads(tags_raw)
            except json.JSONDecodeError:
                tags = {}
        geom = geom_json if isinstance(geom_json, dict) else json.loads(geom_json or "{}")
        if not geom or not geom.get("type"):
            continue
        props = dict(tags)
        props.setdefault("name", props.get("pipeline_name") or props.get("segment_name") or project_id)
        props["segment_key"] = segment_key
        props["project_id"] = project_id
        props["layer_id"] = "gem_pipelines"
        props["source"] = SOURCE_ID
        props["attribution"] = ATTRIBUTION
        features.append(
            {
                "type": "Feature",
                "id": segment_key,
                "geometry": geom,
                "properties": props,
            }
        )

    coverage_gap = bool(bbox) and len(features) == 0 and stats["feature_count"] > 0
    return {
        "type": "FeatureCollection",
        "features": features,
        "layer_id": "gem_pipelines",
        "label": LAYER_LABEL,
        "bbox": list(bbox) if bbox else None,
        "feature_count": len(features),
        "data_as_of": stats.get("last_fetched_at") or _now_iso(),
        "attribution": ATTRIBUTION,
        "license_note": LICENSE_NOTE,
        "limitations": LIMITATIONS,
        "source": "database",
        "cached": True,
        "coverage_gap": coverage_gap,
        "db_feature_total": stats.get("feature_count"),
    }


def _empty_response(
    *,
    bbox: Optional[tuple[float, float, float, float]],
    coverage_gap: bool,
    hint: str,
) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": [],
        "layer_id": "gem_pipelines",
        "label": LAYER_LABEL,
        "bbox": list(bbox) if bbox else None,
        "feature_count": 0,
        "data_as_of": _now_iso(),
        "attribution": ATTRIBUTION,
        "license_note": LICENSE_NOTE,
        "limitations": LIMITATIONS + [hint],
        "source": "database",
        "cached": True,
        "coverage_gap": coverage_gap,
        "hint": hint,
        "db_feature_total": 0,
    }
