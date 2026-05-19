"""Persistence for OSM petroleum feature snapshots (pipelines, refineries).

Nightly worker materializes Overpass tiles into ``petroleum_osm_features``.
Map API reads DB first, then falls back to live Overpass for cold cache.
"""

from __future__ import annotations

import json
import time
from typing import Any, Callable, Optional

try:
    from backend.services.petroleum_osm_overpass import (
        OSM_LAYERS,
        WORLD_TILES,
        _dedupe_features,
        _element_to_feature,
        _feature_in_bbox,
        _now_iso,
        fetch_overpass_elements,
        get_osm_layer_catalog,
    )
except ImportError:
    from services.petroleum_osm_overpass import (  # type: ignore
        OSM_LAYERS,
        WORLD_TILES,
        _dedupe_features,
        _element_to_feature,
        _feature_in_bbox,
        _now_iso,
        fetch_overpass_elements,
        get_osm_layer_catalog,
    )


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
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_petroleum_osm_features_geom
            ON petroleum_osm_features USING GIST (geom);
            """
        )


def layer_has_cached_features(conn: Any, layer_id: str) -> bool:
    ensure_petroleum_osm_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM petroleum_osm_features WHERE layer_id = %s LIMIT 1;",
            (layer_id,),
        )
        return cur.fetchone() is not None


def layer_feature_stats(conn: Any, layer_id: str) -> dict[str, Any]:
    ensure_petroleum_osm_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)::int, MAX(fetched_at)
            FROM petroleum_osm_features
            WHERE layer_id = %s;
            """,
            (layer_id,),
        )
        row = cur.fetchone()
    count = int(row[0]) if row else 0
    fetched_at = row[1] if row else None
    return {
        "feature_count": count,
        "last_fetched_at": fetched_at.isoformat() if hasattr(fetched_at, "isoformat") else fetched_at,
    }


def upsert_feature(conn: Any, layer_id: str, feature: dict[str, Any]) -> bool:
    """Upsert one GeoJSON feature. Returns True when written."""
    props = feature.get("properties") or {}
    osm_type = props.get("osm_type")
    osm_id = props.get("osm_id")
    if not osm_type or osm_id is None:
        return False

    geom = feature.get("geometry")
    if not geom:
        return False

    tags = {k: v for k, v in props.items() if k not in ("osm_type", "osm_id", "layer_id")}
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO petroleum_osm_features (osm_type, osm_id, layer_id, tags, geom, fetched_at)
            VALUES (%s, %s, %s, %s::jsonb, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), NOW())
            ON CONFLICT (osm_type, osm_id, layer_id) DO UPDATE SET
                tags = EXCLUDED.tags,
                geom = EXCLUDED.geom,
                fetched_at = NOW();
            """,
            (osm_type, int(osm_id), layer_id, json.dumps(tags), json.dumps(geom)),
        )
    return True


def sync_layer_tiles(
    conn: Any,
    layer_id: str,
    *,
    sleep_fn: Optional[Callable[[float], None]] = None,
    tiles: Optional[list[tuple[str, tuple[float, float, float, float]]]] = None,
) -> dict[str, Any]:
    """
    Fetch all world tiles for a layer and upsert into petroleum_osm_features.
    Respects Overpass rate limits via sleep between tiles.
    """
    if layer_id not in OSM_LAYERS:
        raise KeyError(layer_id)

    ensure_petroleum_osm_tables(conn)
    pause = sleep_fn or time.sleep
    tile_list = tiles if tiles is not None else list(WORLD_TILES)
    written = 0
    errors: list[str] = []

    for tile_name, tile_bbox in tile_list:
        try:
            elements = fetch_overpass_elements(layer_id, tile_bbox)
            for element in elements:
                feat = _element_to_feature(layer_id, element)
                if feat and upsert_feature(conn, layer_id, feat):
                    written += 1
            conn.commit()
        except Exception as exc:
            conn.rollback()
            errors.append(f"{tile_name}: {exc}")
        pause(max(0.5, float(__import__("os").getenv("PETROLEUM_OSM_TILE_SLEEP_SECONDS", "2.0"))))

    return {
        "layer_id": layer_id,
        "tiles_processed": len(tile_list),
        "features_upserted": written,
        "errors": errors,
        "status": "success" if not errors else ("partial" if written else "error"),
    }


def sync_all_layers(
    conn: Any,
    *,
    layer_ids: Optional[list[str]] = None,
    sleep_fn: Optional[Callable[[float], None]] = None,
) -> dict[str, Any]:
    targets = layer_ids or list(OSM_LAYERS.keys())
    results = []
    for layer_id in targets:
        results.append(sync_layer_tiles(conn, layer_id, sleep_fn=sleep_fn))
    return {"layers": results, "status": "success"}


def get_layer_geojson_from_db(
    conn: Any,
    layer_id: str,
    *,
    bbox: Optional[tuple[float, float, float, float]] = None,
) -> dict[str, Any]:
    """Build a GeoJSON FeatureCollection from persisted OSM rows."""
    if layer_id not in OSM_LAYERS:
        raise KeyError(layer_id)

    ensure_petroleum_osm_tables(conn)
    params: list[Any] = [layer_id]
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

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT osm_type, osm_id, tags, ST_AsGeoJSON(geom)::json
            FROM petroleum_osm_features
            WHERE layer_id = %s
            {bbox_clause}
            ORDER BY osm_id
            LIMIT 50000;
            """,
            tuple(params),
        )
        rows = cur.fetchall()

    features: list[dict[str, Any]] = []
    for osm_type, osm_id, tags_raw, geom_json in rows:
        tags = tags_raw if isinstance(tags_raw, dict) else {}
        if isinstance(tags_raw, str):
            try:
                tags = json.loads(tags_raw)
            except json.JSONDecodeError:
                tags = {}
        geom = geom_json if isinstance(geom_json, dict) else json.loads(geom_json or "{}")
        name = tags.get("name") or tags.get("operator") or f"OSM {osm_type} {osm_id}"
        feat = {
            "type": "Feature",
            "id": f"osm/{osm_type}/{osm_id}",
            "geometry": geom,
            "properties": {
                **tags,
                "name": name,
                "layer_id": layer_id,
                "osm_type": osm_type,
                "osm_id": osm_id,
                "source": "openstreetmap",
                "attribution": "© OpenStreetMap contributors (ODbL)",
                "persisted": True,
            },
        }
        if bbox and not _feature_in_bbox(feat, bbox):
            continue
        features.append(feat)

    features = _dedupe_features(features)
    meta = OSM_LAYERS[layer_id]
    stats = layer_feature_stats(conn, layer_id)
    catalog = get_osm_layer_catalog()
    return {
        "type": "FeatureCollection",
        "features": features,
        "layer_id": layer_id,
        "label": meta["label"],
        "bbox": list(bbox) if bbox else None,
        "feature_count": len(features),
        "data_as_of": stats.get("last_fetched_at") or _now_iso(),
        "attribution": "© OpenStreetMap contributors (ODbL)",
        "license_note": "Community OSM — persisted snapshot; not official cadastre.",
        "limitations": catalog["limitations"],
        "source": "database",
        "cached": True,
        "db_feature_total": stats.get("feature_count"),
    }


def get_osm_layer_geojson_with_fallback(
    conn: Any,
    layer_id: str,
    *,
    bbox: Optional[tuple[float, float, float, float]] = None,
) -> dict[str, Any]:
    """Read persisted features when available; otherwise live Overpass."""
    try:
        from backend.services.petroleum_osm_overpass import get_osm_layer_geojson
    except ImportError:
        from services.petroleum_osm_overpass import get_osm_layer_geojson

    if layer_has_cached_features(conn, layer_id):
        payload = get_layer_geojson_from_db(conn, layer_id, bbox=bbox)
        if payload.get("feature_count", 0) > 0 or bbox is None:
            return payload

    live = get_osm_layer_geojson(layer_id, bbox=bbox)
    live["source"] = "overpass"
    return live
