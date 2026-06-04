"""Persisted GEM GGIT LNG terminals — map GeoJSON API."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

SOURCE_ID = "gem_ggit_lng_terminals_september_2025"
LAYER_LABEL = "LNG terminals — GEM GGIT"
ATTRIBUTION = "© Global Energy Monitor (GGIT LNG, September 2025)"
LICENSE_NOTE = (
    "Global Gas Infrastructure Tracker LNG terminals release. "
    "NGO-researched import/export hubs; not official port authority or berth contracts."
)
LIMITATIONS = [
    "GEM lists LNG terminal owners/operators — not tank farm lessors or storage contractors.",
    "Import/export capacity and status are research estimates — verify on the ground.",
    "Complements GOIT (pipelines only) and OSM (variable LNG tagging).",
]
DEFAULT_BBOX_LIMIT = 4000


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ensure_gem_lng_tables(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS gem_lng_terminals (
                id BIGSERIAL PRIMARY KEY,
                terminal_key TEXT NOT NULL UNIQUE,
                gem_location_id TEXT NOT NULL,
                geom GEOMETRY(Point, 4326) NOT NULL,
                tags JSONB NOT NULL DEFAULT '{}'::jsonb,
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_gem_lng_terminals_gem_location_id
            ON gem_lng_terminals (gem_location_id);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_gem_lng_terminals_geom
            ON gem_lng_terminals USING GIST (geom);
            """
        )


def terminal_stats(conn: Any) -> dict[str, Any]:
    ensure_gem_lng_tables(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM gem_lng_terminals;")
        total = int(cur.fetchone()[0] or 0)
        cur.execute("SELECT MAX(fetched_at) FROM gem_lng_terminals;")
        last = cur.fetchone()[0]
    return {
        "feature_count": total,
        "last_fetched_at": last.isoformat() if last else None,
    }


def get_gem_lng_terminals_geojson(
    conn: Any,
    *,
    bbox: Optional[tuple[float, float, float, float]] = None,
    zoom: Optional[float] = None,
    limit: int = DEFAULT_BBOX_LIMIT,
) -> dict[str, Any]:
    del zoom  # reserved for LOD parity with plants API
    ensure_gem_lng_tables(conn)
    stats = terminal_stats(conn)
    if stats["feature_count"] == 0:
        return _empty_response(
            bbox=bbox,
            coverage_gap=True,
            hint="run POST /api/admin/gem-ggit-lng/ingest",
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
            SELECT terminal_key, gem_location_id, tags, ST_AsGeoJSON(geom)::json
            FROM gem_lng_terminals
            WHERE 1=1
            {bbox_clause}
            ORDER BY gem_location_id
            LIMIT %s;
            """,
            tuple(params),
        )
        rows = cur.fetchall()

    features: list[dict[str, Any]] = []
    for terminal_key, gem_location_id, tags_raw, geom_json in rows:
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
        props.setdefault("name", props.get("terminal_name") or gem_location_id)
        props["terminal_key"] = terminal_key
        props["gem_location_id"] = gem_location_id
        props["layer_id"] = "gem_lng_terminals"
        props["source"] = SOURCE_ID
        props["attribution"] = ATTRIBUTION
        features.append(
            {
                "type": "Feature",
                "id": terminal_key,
                "geometry": geom,
                "properties": props,
            }
        )

    coverage_gap = bool(bbox) and len(features) == 0 and stats["feature_count"] > 0
    return {
        "type": "FeatureCollection",
        "features": features,
        "layer_id": "gem_lng_terminals",
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
        "layer_id": "gem_lng_terminals",
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
