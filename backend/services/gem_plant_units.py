"""Persisted GEM GOGPT oil/gas power plant units — map GeoJSON API."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

SOURCE_ID = "gem_gogpt_plants_january_2026"
LAYER_LABEL = "Oil & gas plants — GEM GOGPT"
ATTRIBUTION = "© Global Energy Monitor (GOGPT, January 2026)"
LICENSE_NOTE = (
    "Global Oil and Gas Plant Tracker, January 2026 release. "
    "Community-researched power and CHP units; not official licensing or tank lease data."
)
LIMITATIONS = [
    "GEM lists plant owners/operators/parents — not tank farm lessors or storage contractors.",
    "Use counterparties for diligence and outreach; verify leases and capacity on the ground.",
    "Location may be exact or approximate per GEM Location accuracy field.",
]
DEFAULT_BBOX_LIMIT = 8000


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ensure_gem_plant_tables(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS gem_plant_units (
                id BIGSERIAL PRIMARY KEY,
                unit_key TEXT NOT NULL UNIQUE,
                gem_unit_id TEXT NOT NULL,
                geom GEOMETRY(Point, 4326) NOT NULL,
                tags JSONB NOT NULL DEFAULT '{}'::jsonb,
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_gem_plant_units_gem_unit_id
            ON gem_plant_units (gem_unit_id);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_gem_plant_units_geom
            ON gem_plant_units USING GIST (geom);
            """
        )


def plant_stats(conn: Any) -> dict[str, Any]:
    ensure_gem_plant_tables(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM gem_plant_units;")
        total = int(cur.fetchone()[0] or 0)
        cur.execute("SELECT MAX(fetched_at) FROM gem_plant_units;")
        last = cur.fetchone()[0]
    return {
        "feature_count": total,
        "last_fetched_at": last.isoformat() if last else None,
    }


def get_gem_plants_geojson(
    conn: Any,
    *,
    bbox: Optional[tuple[float, float, float, float]] = None,
    zoom: Optional[float] = None,
    limit: int = DEFAULT_BBOX_LIMIT,
) -> dict[str, Any]:
    ensure_gem_plant_tables(conn)
    stats = plant_stats(conn)
    if stats["feature_count"] == 0:
        return _empty_response(
            bbox=bbox,
            coverage_gap=True,
            hint="run POST /api/admin/gem-gogpt-plants/ingest",
        )

    params: list[Any] = []
    bbox_clause = ""
    if bbox is not None:
        south, west, north, east = bbox
        bbox_clause = """
            AND ST_Intersects(
                geom,
                ST_MakeEnvelope(%s, %s, %s, %s, 4326)
            )
        """
        params.extend([west, south, east, north])

    params.append(max(1, min(limit, 25000)))

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT unit_key, gem_unit_id, tags, ST_AsGeoJSON(geom)::json
            FROM gem_plant_units
            WHERE 1=1
            {bbox_clause}
            ORDER BY gem_unit_id
            LIMIT %s;
            """,
            tuple(params),
        )
        rows = cur.fetchall()

    features: list[dict[str, Any]] = []
    for unit_key, gem_unit_id, tags_raw, geom_json in rows:
        tags = tags_raw if isinstance(tags_raw, dict) else {}
        if isinstance(tags_raw, str):
            try:
                tags = json.loads(tags_raw)
            except json.JSONDecodeError:
                tags = {}
        geom = geom_json if isinstance(geom_json, dict) else json.loads(geom_json or "{}")
        if not geom or geom.get("type") != "Point":
            continue
        props = dict(tags)
        props.setdefault("name", props.get("plant_name") or props.get("unit_name") or gem_unit_id)
        props["unit_key"] = unit_key
        props["gem_unit_id"] = gem_unit_id
        props["layer_id"] = "gem_plants"
        props["source"] = SOURCE_ID
        props["attribution"] = ATTRIBUTION
        features.append(
            {
                "type": "Feature",
                "id": unit_key,
                "geometry": geom,
                "properties": props,
            }
        )

    coverage_gap = bool(bbox) and len(features) == 0 and stats["feature_count"] > 0
    return {
        "type": "FeatureCollection",
        "features": features,
        "layer_id": "gem_plants",
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
        "layer_id": "gem_plants",
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
