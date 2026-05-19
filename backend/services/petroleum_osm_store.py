"""Persistence stub for nightly OSM petroleum feature snapshots (Phase 3 roadmap).

Live map layers still use Overpass via petroleum_osm_overpass.py. This table is reserved
for a future worker that materializes pipeline/refinery geometries into PostGIS.
"""

from __future__ import annotations

from typing import Any


def ensure_petroleum_osm_tables(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS petroleum_osm_features (
                id BIGSERIAL PRIMARY KEY,
                osm_type TEXT NOT NULL,
                osm_id BIGINT NOT NULL,
                layer_id TEXT NOT NULL,
                tags JSONB,
                geom GEOMETRY(Geometry, 4326),
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (osm_type, osm_id, layer_id)
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_petroleum_osm_features_layer
            ON petroleum_osm_features (layer_id);
            """
        )
