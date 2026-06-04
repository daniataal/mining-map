"""Persistence for OSM petroleum feature snapshots (pipelines, refineries).

Nightly worker materializes Overpass tiles into ``petroleum_osm_features``.
Map API reads DB only by default; live Overpass on the request path is opt-in.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

# Default off — same posture as STORAGE_SKIP_LIVE_OVERPASS in docker-compose.
PETROLEUM_OSMLAYER_LIVE_OVERPASS = (os.getenv("PETROLEUM_OSMLAYER_LIVE_OVERPASS") or "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
OSM_LAYER_STALE_DAYS = int(os.getenv("PETROLEUM_OSM_LAYER_STALE_DAYS", "30") or "30")
OSM_COVERAGE_GAP_HINT = "run petroleum-osm worker or graph-sync"


def petroleum_osm_live_overpass_enabled() -> bool:
    """True when live Overpass is allowed on GET /api/petroleum/osm-layers/{id}."""
    return PETROLEUM_OSMLAYER_LIVE_OVERPASS

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


def sync_layers_for_tiles(
    conn: Any,
    *,
    tile_names: Optional[str] = None,
    from_gap_queue: bool = False,
    layer_ids: Optional[list[str]] = None,
    sleep_fn: Optional[Callable[[float], None]] = None,
) -> dict[str, Any]:
    """Sync selected world tiles (comma-separated names) or tiles listed in storage_gap_queue.json."""
    tile_list: list[tuple[str, tuple[float, float, float, float]]] = list(WORLD_TILES)
    if from_gap_queue:
        try:
            from backend.services.storage_coverage_report import GAP_QUEUE_PATH
        except ImportError:
            from services.storage_coverage_report import GAP_QUEUE_PATH  # type: ignore
        if GAP_QUEUE_PATH.is_file():
            payload = json.loads(GAP_QUEUE_PATH.read_text(encoding="utf-8"))
            queued = payload.get("tiles") or []
            tile_list = [
                (str(row["tile"]), tuple(row["bbox"]))
                for row in queued
                if isinstance(row, dict) and row.get("tile") and isinstance(row.get("bbox"), list)
            ]
    elif tile_names:
        wanted = {name.strip() for name in tile_names.split(",") if name.strip()}
        tile_list = [(name, bbox) for name, bbox in WORLD_TILES if name in wanted]
    targets = layer_ids or list(OSM_LAYERS.keys())
    results = []
    total_written = 0
    all_errors: list[str] = []
    for layer_id in targets:
        layer_result = sync_layer_tiles(conn, layer_id, sleep_fn=sleep_fn, tiles=tile_list)
        results.append(layer_result)
        total_written += int(layer_result.get("features_upserted") or 0)
        all_errors.extend(layer_result.get("errors") or [])
    status = "success"
    if all_errors:
        status = "partial" if total_written else "error"
    return {
        "layers": results,
        "status": status,
        "features_upserted": total_written,
        "errors": all_errors,
        "tiles": [name for name, _ in tile_list],
    }


def sync_all_layers(
    conn: Any,
    *,
    layer_ids: Optional[list[str]] = None,
    sleep_fn: Optional[Callable[[float], None]] = None,
    log_run: bool = True,
) -> dict[str, Any]:
    targets = layer_ids or list(OSM_LAYERS.keys())
    run_id: int | None = None
    if log_run:
        try:
            try:
                from backend.services.petroleum_osm_sync_store import (
                    ensure_petroleum_osm_sync_tables,
                    finish_sync_run,
                    start_sync_run,
                )
            except ImportError:
                from services.petroleum_osm_sync_store import (
                    ensure_petroleum_osm_sync_tables,
                    finish_sync_run,
                    start_sync_run,
                )
            ensure_petroleum_osm_sync_tables(conn)
            run_id = start_sync_run(conn)
            conn.commit()
        except Exception as exc:
            print(f"[petroleum-osm] sync run log skipped: {exc}")
            run_id = None

    results = []
    total_written = 0
    all_errors: list[str] = []
    for layer_id in targets:
        layer_result = sync_layer_tiles(conn, layer_id, sleep_fn=sleep_fn)
        results.append(layer_result)
        total_written += int(layer_result.get("features_upserted") or 0)
        all_errors.extend(layer_result.get("errors") or [])

    status = "success"
    if all_errors:
        status = "partial" if total_written else "error"

    summary = {"layers": results, "status": status, "features_upserted": total_written, "errors": all_errors}

    if run_id is not None:
        try:
            try:
                from backend.services.petroleum_osm_sync_store import finish_sync_run
            except ImportError:
                from services.petroleum_osm_sync_store import finish_sync_run
            finish_sync_run(
                conn,
                run_id,
                status=status,
                layers_processed=len(targets),
                features_upserted=total_written,
                errors=all_errors,
            )
            summary["run_id"] = run_id
        except Exception as exc:
            print(f"[petroleum-osm] finish sync run failed: {exc}")

    return summary


def get_layer_geojson_from_db(
    conn: Any,
    layer_id: str,
    *,
    bbox: Optional[tuple[float, float, float, float]] = None,
    zoom: Optional[float] = None,
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

    try:
        from backend.services.license_map_perf import simplify_tolerance_for_zoom
    except ImportError:
        from services.license_map_perf import simplify_tolerance_for_zoom

    tolerance = simplify_tolerance_for_zoom(zoom)
    if tolerance > 0:
        geom_sql = "ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom::geometry, %s))::json"
        params.append(tolerance)
    else:
        geom_sql = "ST_AsGeoJSON(geom)::json"

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT osm_type, osm_id, tags, {geom_sql}
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


def _layer_is_stale(stats: dict[str, Any]) -> bool:
    raw = stats.get("last_fetched_at")
    if not raw:
        return True
    try:
        if isinstance(raw, str):
            fetched_at = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        else:
            fetched_at = raw
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - fetched_at.astimezone(timezone.utc)
        return age.days >= max(1, OSM_LAYER_STALE_DAYS)
    except (TypeError, ValueError):
        return True


def build_empty_osm_layer_response(
    conn: Any,
    layer_id: str,
    *,
    bbox: Optional[tuple[float, float, float, float]] = None,
    stale: bool = True,
    hint: str = OSM_COVERAGE_GAP_HINT,
) -> dict[str, Any]:
    """Honest empty GeoJSON when the persisted OSM snapshot is missing or stale."""
    if layer_id not in OSM_LAYERS:
        raise KeyError(layer_id)

    stats = layer_feature_stats(conn, layer_id)
    meta = OSM_LAYERS[layer_id]
    catalog = get_osm_layer_catalog()
    return {
        "type": "FeatureCollection",
        "features": [],
        "layer_id": layer_id,
        "label": meta["label"],
        "bbox": list(bbox) if bbox else None,
        "feature_count": 0,
        "data_as_of": stats.get("last_fetched_at") or _now_iso(),
        "attribution": "© OpenStreetMap contributors (ODbL)",
        "license_note": "Community OSM — persisted snapshot; not official cadastre.",
        "limitations": catalog["limitations"],
        "source": "database",
        "cached": False,
        "coverage_gap": True,
        "stale": stale,
        "hint": hint,
        "db_feature_total": stats.get("feature_count") or 0,
        "read_path": "postgres",
    }


def get_osm_layer_geojson_with_fallback(
    conn: Any,
    layer_id: str,
    *,
    bbox: Optional[tuple[float, float, float, float]] = None,
    zoom: Optional[float] = None,
) -> dict[str, Any]:
    """Read persisted features only unless PETROLEUM_OSMLAYER_LIVE_OVERPASS=1."""
    if layer_has_cached_features(conn, layer_id):
        payload = get_layer_geojson_from_db(conn, layer_id, bbox=bbox, zoom=zoom)
        stats = layer_feature_stats(conn, layer_id)
        stale = _layer_is_stale(stats)
        payload["coverage_gap"] = False
        payload["stale"] = stale
        payload["read_path"] = "postgres"
        if stale and int(stats.get("feature_count") or 0) == 0:
            payload["coverage_gap"] = True
            payload["hint"] = OSM_COVERAGE_GAP_HINT
        return payload

    if petroleum_osm_live_overpass_enabled():
        try:
            from backend.services.petroleum_osm_overpass import get_osm_layer_geojson
        except ImportError:
            from services.petroleum_osm_overpass import get_osm_layer_geojson

        live = get_osm_layer_geojson(layer_id, bbox=bbox)
        live["source"] = "overpass"
        live["read_path"] = "overpass"
        live["coverage_gap"] = live.get("feature_count", 0) == 0
        live["stale"] = False
        if live["coverage_gap"]:
            live["hint"] = OSM_COVERAGE_GAP_HINT
        return live

    return build_empty_osm_layer_response(conn, layer_id, bbox=bbox)
