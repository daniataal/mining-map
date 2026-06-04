"""Compare GEM GOIT pipeline segments vs OSM petroleum_osm_features in a viewport."""

from __future__ import annotations

from typing import Any, Optional

try:
    from backend.services.gem_pipeline_segments import ensure_gem_pipeline_tables, segment_stats
    from backend.services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats
except ImportError:
    from services.gem_pipeline_segments import ensure_gem_pipeline_tables, segment_stats  # type: ignore
    from services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats  # type: ignore

MATCH_DISTANCE_M = 2000.0


def _parse_bbox(
    south: Optional[float],
    west: Optional[float],
    north: Optional[float],
    east: Optional[float],
) -> Optional[tuple[float, float, float, float]]:
    if south is None and west is None and north is None and east is None:
        return None
    if south is None or west is None or north is None or east is None:
        raise ValueError("bbox requires all of south, west, north, east")
    bbox = (float(south), float(west), float(north), float(east))
    if bbox[0] >= bbox[2] or bbox[1] >= bbox[3]:
        raise ValueError("invalid bbox")
    return bbox


def build_gem_osm_pipeline_coverage(
    conn: Any,
    *,
    bbox: Optional[tuple[float, float, float, float]] = None,
) -> dict[str, Any]:
    ensure_gem_pipeline_tables(conn)
    ensure_petroleum_osm_tables(conn)
    gem_stats = segment_stats(conn)
    osm_stats = layer_feature_stats(conn, "pipelines")

    out: dict[str, Any] = {
        "gem_segment_total": gem_stats.get("feature_count", 0),
        "osm_pipeline_total": osm_stats.get("feature_count", 0),
        "viewport_bbox": list(bbox) if bbox else None,
        "match_distance_m": MATCH_DISTANCE_M,
        "limitations": [
            "GEM-only means no OSM pipeline geometry within 2 km of the GEM segment.",
            "OSM-only means OSM pipeline in viewport with no GEM segment within 2 km.",
        ],
    }

    if bbox is None:
        out["note"] = "Provide south, west, north, east for viewport comparison counts."
        return out

    south, west, north, east = bbox
    envelope_params = [west, south, east, north]

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) FROM gem_pipeline_segments g
            WHERE ST_Intersects(g.geom, ST_MakeEnvelope(%s, %s, %s, %s, 4326));
            """,
            envelope_params,
        )
        gem_in_view = int(cur.fetchone()[0] or 0)

        cur.execute(
            """
            SELECT COUNT(*) FROM petroleum_osm_features o
            WHERE layer_id = 'pipelines'
              AND ST_Intersects(o.geom, ST_MakeEnvelope(%s, %s, %s, %s, 4326));
            """,
            envelope_params,
        )
        osm_in_view = int(cur.fetchone()[0] or 0)

        cur.execute(
            """
            SELECT COUNT(*) FROM gem_pipeline_segments g
            WHERE ST_Intersects(g.geom, ST_MakeEnvelope(%s, %s, %s, %s, 4326))
              AND NOT EXISTS (
                SELECT 1 FROM petroleum_osm_features o
                WHERE o.layer_id = 'pipelines'
                  AND ST_DWithin(g.geom::geography, o.geom::geography, %s)
              );
            """,
            (*envelope_params, MATCH_DISTANCE_M),
        )
        gem_only = int(cur.fetchone()[0] or 0)

        cur.execute(
            """
            SELECT COUNT(*) FROM petroleum_osm_features o
            WHERE o.layer_id = 'pipelines'
              AND ST_Intersects(o.geom, ST_MakeEnvelope(%s, %s, %s, %s, 4326))
              AND NOT EXISTS (
                SELECT 1 FROM gem_pipeline_segments g
                WHERE ST_DWithin(o.geom::geography, g.geom::geography, %s)
              );
            """,
            (*envelope_params, MATCH_DISTANCE_M),
        )
        osm_only = int(cur.fetchone()[0] or 0)

    out.update(
        {
            "gem_in_viewport": gem_in_view,
            "osm_in_viewport": osm_in_view,
            "gem_only_in_viewport": gem_only,
            "osm_only_in_viewport": osm_only,
            "both_within_match_distance": max(0, gem_in_view - gem_only),
            "coverage_gap": gem_in_view == 0 and osm_in_view == 0,
        }
    )
    return out
