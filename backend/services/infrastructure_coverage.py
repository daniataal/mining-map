"""Viewport infrastructure coverage: OSM vs GEM vs storage (honest complementary layers)."""

from __future__ import annotations

import json
from typing import Any, Optional

try:
    from backend.services.gem_pipeline_coverage import MATCH_DISTANCE_M, _parse_bbox
    from backend.services.gem_pipeline_coverage import build_gem_osm_pipeline_coverage
    from backend.services.gem_pipeline_segments import ensure_gem_pipeline_tables, segment_stats
    from backend.services.gem_lng_terminals import ensure_gem_lng_tables, terminal_stats
    from backend.services.gem_plant_units import ensure_gem_plant_tables, plant_stats
    from backend.services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats
except ImportError:
    from services.gem_pipeline_coverage import MATCH_DISTANCE_M, _parse_bbox, build_gem_osm_pipeline_coverage  # type: ignore
    from services.gem_pipeline_segments import ensure_gem_pipeline_tables, segment_stats  # type: ignore
    from services.gem_lng_terminals import ensure_gem_lng_tables, terminal_stats  # type: ignore
    from services.gem_plant_units import ensure_gem_plant_tables, plant_stats  # type: ignore
    from services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats  # type: ignore

LIMITATIONS = [
    "OSM = community-mapped visible infrastructure; tags vary by region.",
    "GEM = NGO project data (capacity, owners); not official cadastre or tank lessors.",
    "Layers are complementary — high counts in one source do not invalidate another.",
    "GOIT tracks pipelines only; oil storage is not in GEM GOIT (use OSM storage layer).",
]


def _count_in_bbox(
    conn: Any,
    table: str,
    geom_column: str,
    bbox: tuple[float, float, float, float],
    *,
    where: str = "",
    params_extra: tuple[Any, ...] = (),
) -> int:
    south, west, north, east = bbox
    clause = f" AND ({where})" if where else ""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT COUNT(*) FROM {table}
            WHERE ST_Intersects(
                {geom_column},
                ST_MakeEnvelope(%s, %s, %s, %s, 4326)
            ){clause};
            """,
            (west, south, east, north, *params_extra),
        )
        return int(cur.fetchone()[0] or 0)


def _extraction_fields_in_bbox(conn: Any, bbox: tuple[float, float, float, float]) -> int:
    south, west, north, east = bbox
    delta = 0.5
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) FROM licenses
            WHERE sector = 'oil_and_gas'
              AND lat IS NOT NULL AND lng IS NOT NULL
              AND lat BETWEEN %s AND %s
              AND lng BETWEEN %s AND %s;
            """,
            (south - delta, north + delta, west - delta, east + delta),
        )
        return int(cur.fetchone()[0] or 0)


def build_infrastructure_coverage(
    conn: Any,
    *,
    bbox: Optional[tuple[float, float, float, float]] = None,
) -> dict[str, Any]:
    ensure_petroleum_osm_tables(conn)
    ensure_gem_pipeline_tables(conn)
    ensure_gem_plant_tables(conn)
    ensure_gem_lng_tables(conn)

    gem_global = segment_stats(conn)
    plant_global = plant_stats(conn)
    lng_global = terminal_stats(conn)
    osm_pipe_global = layer_feature_stats(conn, "pipelines")
    osm_ref_global = layer_feature_stats(conn, "refineries")
    osm_storage_global = layer_feature_stats(conn, "storage_terminals")

    out: dict[str, Any] = {
        "viewport_bbox": list(bbox) if bbox else None,
        "global": {
            "osm_pipelines": osm_pipe_global.get("feature_count", 0),
            "osm_refineries": osm_ref_global.get("feature_count", 0),
            "osm_storage": osm_storage_global.get("feature_count", 0),
            "gem_pipelines": gem_global.get("feature_count", 0),
            "gem_plants": plant_global.get("feature_count", 0),
            "gem_lng_terminals": lng_global.get("feature_count", 0),
        },
        "limitations": list(LIMITATIONS),
        "match_distance_m": MATCH_DISTANCE_M,
    }

    if bbox is None:
        out["note"] = "Provide south, west, north, east for viewport counts."
        return out

    pipeline_compare = build_gem_osm_pipeline_coverage(conn, bbox=bbox)
    out["pipeline_comparison"] = pipeline_compare

    out["viewport"] = {
        "osm_pipelines": pipeline_compare.get("osm_in_viewport", 0),
        "osm_refineries": _count_in_bbox(
            conn,
            "petroleum_osm_features",
            "geom",
            bbox,
            where="layer_id = 'refineries'",
        ),
        "osm_storage": _count_in_bbox(
            conn,
            "petroleum_osm_features",
            "geom",
            bbox,
            where="layer_id = 'storage_terminals'",
        ),
        "gem_pipelines": pipeline_compare.get("gem_in_viewport", 0),
        "gem_plants": _count_in_bbox(conn, "gem_plant_units", "geom", bbox),
        "gem_lng_terminals": _count_in_bbox(conn, "gem_lng_terminals", "geom", bbox),
        "gem_extraction_fields": _extraction_fields_in_bbox(conn, bbox),
    }

    vp = out["viewport"]
    out["coverage_gap"] = (
        vp.get("osm_pipelines", 0) == 0
        and vp.get("gem_pipelines", 0) == 0
        and vp.get("osm_storage", 0) == 0
    )
    out["summary_line"] = (
        f"OSM: {vp.get('osm_pipelines', 0)} pipes, {vp.get('osm_refineries', 0)} refineries, "
        f"{vp.get('osm_storage', 0)} storage · "
        f"GEM: {vp.get('gem_pipelines', 0)} pipes, {vp.get('gem_plants', 0)} plants, "
        f"{vp.get('gem_lng_terminals', 0)} LNG, {vp.get('gem_extraction_fields', 0)} fields"
    )
    return out


def nearest_gem_pipeline_segment(
    conn: Any,
    *,
    lat: float,
    lng: float,
    max_distance_m: float = MATCH_DISTANCE_M,
) -> Optional[dict[str, Any]]:
    """Nearest GEM GOIT segment for OSM pipeline popup enrichment."""
    ensure_gem_pipeline_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT segment_key, project_id, tags,
                   ST_Distance(
                       geom::geography,
                       ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
                   ) AS dist_m
            FROM gem_pipeline_segments
            WHERE ST_DWithin(
                geom::geography,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                %s
            )
            ORDER BY dist_m
            LIMIT 1;
            """,
            (lng, lat, lng, lat, max_distance_m),
        )
        row = cur.fetchone()
    if not row:
        return None
    segment_key, project_id, tags_raw, dist_m = row
    tags = tags_raw if isinstance(tags_raw, dict) else json.loads(tags_raw or "{}")
    return {
        "segment_key": segment_key,
        "project_id": project_id,
        "distance_m": round(float(dist_m or 0), 1),
        "distance_km": round(float(dist_m or 0) / 1000.0, 2),
        "tags": tags,
        "source_id": tags.get("source_id"),
        "attribution": "Global Energy Monitor GOIT (CC BY 4.0)",
    }
