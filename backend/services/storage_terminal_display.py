"""Persist full storage-terminal popup payloads (Postgres JSONB).

Materialize at OSM sync / batch job time so map list + detail APIs avoid per-click
reference enrichment. Permanent backend target is Go; this Python module is a bridge.

Re-run after petroleum_osm sync:
  python -m backend.scripts.materialize_storage_terminal_displays
Env: STORAGE_DISPLAY_MATERIALIZE_ENABLED, STORAGE_DISPLAY_MATERIALIZE_LIMIT (default 500).
Disable reads: STORAGE_DISPLAY_READ_ENABLED=false. Rollback: DROP TABLE storage_terminal_display.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

STORAGE_DISPLAY_ENRICHMENT_VERSION = int(os.getenv("STORAGE_DISPLAY_ENRICHMENT_VERSION", "1") or "1")
STORAGE_DISPLAY_MATERIALIZE_LIMIT = int(os.getenv("STORAGE_DISPLAY_MATERIALIZE_LIMIT", "500") or "500")
STORAGE_DISPLAY_MATERIALIZE_ENABLED = (os.getenv("STORAGE_DISPLAY_MATERIALIZE_ENABLED") or "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
STORAGE_DISPLAY_MATERIALIZE_AFTER_OSM_SYNC = (os.getenv("STORAGE_DISPLAY_MATERIALIZE_AFTER_OSM_SYNC", "true") or "").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
STORAGE_DISPLAY_READ_ENABLED = (os.getenv("STORAGE_DISPLAY_READ_ENABLED", "true") or "").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
STORAGE_DISPLAY_WRITE_THROUGH = (os.getenv("STORAGE_DISPLAY_WRITE_THROUGH", "true") or "").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}

try:
    from backend.services.storage_terminals import (
        STORAGE_TERMINALS_LAYER_ID,
        _db_connect,
        _enrich_orphan_tanks_with_site_context,
        _enrich_storage_entity_for_detail,
        _element_from_db_row,
        _now_iso,
        _parse_storage_terminal_osm_id,
        normalize_storage_terminal,
    )
except ImportError:
    from services.storage_terminals import (  # type: ignore
        STORAGE_TERMINALS_LAYER_ID,
        _db_connect,
        _enrich_orphan_tanks_with_site_context,
        _enrich_storage_entity_for_detail,
        _element_from_db_row,
        _now_iso,
        _parse_storage_terminal_osm_id,
        normalize_storage_terminal,
    )


def storage_display_read_enabled() -> bool:
    return STORAGE_DISPLAY_READ_ENABLED


def storage_display_materialize_enabled() -> bool:
    return STORAGE_DISPLAY_MATERIALIZE_ENABLED


def ensure_storage_terminal_display_tables(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS storage_terminal_display (
                terminal_id TEXT PRIMARY KEY,
                osm_type TEXT,
                osm_id BIGINT,
                display_json JSONB NOT NULL,
                enriched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                osm_fetched_at TIMESTAMPTZ,
                enrichment_version INT NOT NULL DEFAULT 1
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_storage_terminal_display_osm
            ON storage_terminal_display (osm_type, osm_id);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_storage_terminal_display_enriched_at
            ON storage_terminal_display (enriched_at DESC);
            """
        )


def _mark_display_ready(entity: dict[str, Any]) -> dict[str, Any]:
    out = dict(entity)
    out["displayReady"] = True
    return out


def _parse_osm_parts(terminal_id: str) -> Optional[tuple[str, int]]:
    parsed = _parse_storage_terminal_osm_id(terminal_id)
    if not parsed:
        return None
    return parsed


def upsert_storage_terminal_display(
    conn: Any,
    *,
    terminal_id: str,
    display_json: dict[str, Any],
    osm_type: Optional[str] = None,
    osm_id: Optional[int] = None,
    osm_fetched_at: Optional[str] = None,
) -> None:
    ensure_storage_terminal_display_tables(conn)
    if osm_type is None or osm_id is None:
        parsed = _parse_osm_parts(terminal_id)
        if parsed:
            osm_type, osm_id = parsed
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO storage_terminal_display (
                terminal_id, osm_type, osm_id, display_json, enriched_at,
                osm_fetched_at, enrichment_version
            )
            VALUES (%s, %s, %s, %s::jsonb, NOW(), %s, %s)
            ON CONFLICT (terminal_id) DO UPDATE SET
                osm_type = EXCLUDED.osm_type,
                osm_id = EXCLUDED.osm_id,
                display_json = EXCLUDED.display_json,
                enriched_at = NOW(),
                osm_fetched_at = EXCLUDED.osm_fetched_at,
                enrichment_version = EXCLUDED.enrichment_version;
            """,
            (
                terminal_id,
                osm_type,
                osm_id,
                json.dumps(display_json, default=str),
                osm_fetched_at,
                STORAGE_DISPLAY_ENRICHMENT_VERSION,
            ),
        )


def load_display_by_id(conn: Any, terminal_id: str) -> Optional[dict[str, Any]]:
    """Return full display entity when materialized and version matches."""
    if not terminal_id:
        return None
    ensure_storage_terminal_display_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT display_json, enrichment_version
            FROM storage_terminal_display
            WHERE terminal_id = %s
            LIMIT 1;
            """,
            (terminal_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    display_raw, version = row
    if int(version or 0) != STORAGE_DISPLAY_ENRICHMENT_VERSION:
        return None
    if isinstance(display_raw, dict):
        payload = display_raw
    else:
        try:
            payload = json.loads(display_raw or "{}")
        except (TypeError, json.JSONDecodeError):
            return None
    if not isinstance(payload, dict) or not payload.get("id"):
        return None
    return _mark_display_ready(payload)


def load_displays_by_bbox(
    conn: Any,
    bbox: tuple[float, float, float, float],
    *,
    limit: int = 5000,
) -> dict[str, dict[str, Any]]:
    """Map terminal_id → full display entity for OSM rows intersecting bbox."""
    south, west, north, east = bbox
    ensure_storage_terminal_display_tables(conn)
    try:
        from backend.services.petroleum_osm_store import ensure_petroleum_osm_tables
    except ImportError:
        from services.petroleum_osm_store import ensure_petroleum_osm_tables  # type: ignore

    ensure_petroleum_osm_tables(conn)
    cap = max(1, min(int(limit), 5000))
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT d.terminal_id, d.display_json, d.enrichment_version
            FROM storage_terminal_display d
            INNER JOIN petroleum_osm_features f
              ON f.layer_id = %s
             AND f.osm_type = d.osm_type
             AND f.osm_id = d.osm_id
            WHERE d.enrichment_version = %s
              AND ST_Intersects(
                f.geom,
                ST_MakeEnvelope(%s, %s, %s, %s, 4326)
              )
            ORDER BY d.terminal_id
            LIMIT %s;
            """,
            (
                STORAGE_TERMINALS_LAYER_ID,
                STORAGE_DISPLAY_ENRICHMENT_VERSION,
                west,
                south,
                east,
                north,
                cap,
            ),
        )
        rows = cur.fetchall()

    out: dict[str, dict[str, Any]] = {}
    for terminal_id, display_raw, _version in rows:
        if isinstance(display_raw, dict):
            payload = display_raw
        else:
            try:
                payload = json.loads(display_raw or "{}")
            except (TypeError, json.JSONDecodeError):
                continue
        if isinstance(payload, dict) and payload.get("id"):
            out[str(terminal_id)] = _mark_display_ready(payload)
    return out


def build_full_display_entity(
    entity: dict[str, Any],
    fetched_at: str,
    *,
    peer_entities: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Same enrichment as detail API, with batch site-context when peers supplied."""
    enriched = _enrich_storage_entity_for_detail(dict(entity), fetched_at)
    if peer_entities:
        site_pass = _enrich_orphan_tanks_with_site_context(list(peer_entities))
        by_id = {row.get("id"): row for row in site_pass if row.get("id")}
        if enriched.get("id") in by_id:
            enriched = by_id[enriched["id"]]
    return enriched


def _load_osm_elements_for_materialize(
    conn: Any,
    *,
    terminal_ids: Optional[list[str]] = None,
    limit: Optional[int] = None,
) -> tuple[list[dict[str, Any]], Optional[str]]:
    try:
        from backend.services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats
    except ImportError:
        from services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats  # type: ignore

    ensure_petroleum_osm_tables(conn)
    stats = layer_feature_stats(conn, STORAGE_TERMINALS_LAYER_ID)
    fetched_at = stats.get("last_fetched_at")
    id_filter: Optional[set[str]] = None
    if terminal_ids:
        id_filter = {tid.strip() for tid in terminal_ids if tid and tid.strip()}

    params: list[Any] = [STORAGE_TERMINALS_LAYER_ID]
    where_extra = ""
    if id_filter:
        pairs = []
        for tid in id_filter:
            parsed = _parse_osm_parts(tid)
            if parsed:
                pairs.append(parsed)
        if not pairs:
            return [], fetched_at if isinstance(fetched_at, str) else None
        placeholders = ",".join(["(%s, %s)"] * len(pairs))
        where_extra = f" AND (osm_type, osm_id) IN ({placeholders})"
        for osm_type, osm_id in pairs:
            params.extend([osm_type, osm_id])

    cap = limit if limit is not None else STORAGE_DISPLAY_MATERIALIZE_LIMIT
    cap = max(1, int(cap))

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT osm_type, osm_id, tags, ST_AsGeoJSON(geom)::json AS geom_json,
                   ST_Y(ST_Centroid(geom)) AS lat,
                   ST_X(ST_Centroid(geom)) AS lon,
                   ST_YMin(geom) AS south,
                   ST_XMin(geom) AS west,
                   ST_YMax(geom) AS north,
                   ST_XMax(geom) AS east
            FROM petroleum_osm_features
            WHERE layer_id = %s
            {where_extra}
            ORDER BY osm_id
            LIMIT %s;
            """,
            (*params, cap),
        )
        rows = cur.fetchall()

    elements: list[dict[str, Any]] = []
    for osm_type, osm_id, tags_raw, geom_json, lat, lon, south, west, north, east in rows:
        tags = tags_raw if isinstance(tags_raw, dict) else {}
        if isinstance(tags_raw, str):
            try:
                tags = json.loads(tags_raw)
            except json.JSONDecodeError:
                tags = {}
        geom = geom_json if isinstance(geom_json, dict) else json.loads(geom_json or "{}")
        bounds = None
        if all(value is not None for value in (south, west, north, east)):
            bounds = {
                "south": float(south),
                "west": float(west),
                "north": float(north),
                "east": float(east),
            }
        element = _element_from_db_row(
            str(osm_type),
            int(osm_id),
            tags,
            geom,
            lat=float(lat) if lat is not None else None,
            lng=float(lon) if lon is not None else None,
            bounds=bounds,
        )
        if element:
            elements.append(element)
    return elements, fetched_at if isinstance(fetched_at, str) else None


def materialize_storage_displays(
    conn: Any,
    *,
    terminal_ids: Optional[list[str]] = None,
    limit: Optional[int] = None,
) -> dict[str, Any]:
    """Batch UPSERT display_json for OSM storage features (chunked; not for API cold start)."""
    if not storage_display_materialize_enabled():
        return {"status": "skipped", "reason": "STORAGE_DISPLAY_MATERIALIZE_ENABLED is off"}

    ensure_storage_terminal_display_tables(conn)
    elements, osm_fetched_at = _load_osm_elements_for_materialize(
        conn, terminal_ids=terminal_ids, limit=limit
    )
    if not elements:
        return {"status": "skipped", "reason": "no petroleum_osm storage features to materialize"}

    fetched_at = osm_fetched_at or _now_iso()
    normalized: list[dict[str, Any]] = []
    for element in elements:
        entity = normalize_storage_terminal(
            element, fetched_at, include_nearby_port=True, trust_petroleum_layer=True
        )
        if entity:
            normalized.append(entity)

    if not normalized:
        return {"status": "skipped", "reason": "no normalized storage entities"}

    reference_pass = [
        build_full_display_entity(entity, fetched_at, peer_entities=normalized) for entity in normalized
    ]
    final_entities = _enrich_orphan_tanks_with_site_context(reference_pass)

    written = 0
    for entity in final_entities:
        terminal_id = str(entity.get("id") or "")
        if not terminal_id.startswith("osm:"):
            continue
        upsert_storage_terminal_display(
            conn,
            terminal_id=terminal_id,
            display_json=entity,
            osm_fetched_at=osm_fetched_at,
        )
        written += 1

    return {
        "status": "success",
        "written": written,
        "candidates": len(elements),
        "normalized": len(normalized),
        "enrichment_version": STORAGE_DISPLAY_ENRICHMENT_VERSION,
    }


def maybe_materialize_after_osm_sync(conn: Any) -> dict[str, Any]:
    """Called after petroleum_osm worker / graph-sync storage layer refresh."""
    if not STORAGE_DISPLAY_MATERIALIZE_AFTER_OSM_SYNC or not storage_display_materialize_enabled():
        return {"status": "skipped", "reason": "display materialize hook disabled"}
    return materialize_storage_displays(conn, limit=STORAGE_DISPLAY_MATERIALIZE_LIMIT)


def overlay_materialized_on_entities(
    entities: list[dict[str, Any]],
    *,
    bbox: Optional[tuple[float, float, float, float]],
    summary: bool = True,
) -> list[dict[str, Any]]:
    """Replace OSM entities in list/viewport when Postgres display rows exist."""
    if not storage_display_read_enabled() or bbox is None:
        return entities

    conn = _db_connect()
    try:
        materialized = load_displays_by_bbox(conn, bbox)
    finally:
        conn.close()

    if not materialized:
        return entities

    try:
        from backend.services.storage_terminals import _summary_entity
    except ImportError:
        from services.storage_terminals import _summary_entity  # type: ignore

    merged: list[dict[str, Any]] = []
    for entity in entities:
        terminal_id = str(entity.get("id") or "")
        display = materialized.get(terminal_id)
        if display:
            row = _summary_entity(display) if summary else dict(display)
            row["displayReady"] = True
            merged.append(row)
        else:
            merged.append(entity)
    return merged
