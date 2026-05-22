"""Multi-source vessel position observations — merge never override across sources."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

try:
    from psycopg2.extras import Json
except ImportError:
    Json = None  # type: ignore

TABLE = "oil_vessel_position_observations"
DATA_SOURCE_MARITIME_REDIS = "maritime_redis"
SOURCE_TYPE_COMMUNITY_AIS = "community_coastal_ais"
AISSTREAM_DOC_URL = "https://aisstream.io/documentation.html"


def _pg_json(obj: Any) -> Any:
    if Json is None:
        return json.dumps(obj)
    return Json(obj)


def _parse_mmsi(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _parse_observed_at(row: dict[str, Any]) -> datetime:
    for key in ("observed_at", "last_seen_at", "ts"):
        raw = row.get(key)
        if raw is None:
            continue
        if isinstance(raw, datetime):
            dt = raw
        else:
            text = str(raw).strip().replace("Z", "+00:00")
            try:
                dt = datetime.fromisoformat(text)
            except ValueError:
                continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def _parse_optional_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _table_exists_named(cur: Any, table_name: str) -> bool:
    cur.execute(
        """
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = %s
        )
        """,
        (table_name,),
    )
    row = cur.fetchone()
    return bool(row[0]) if row else False


def _table_exists(cur: Any) -> bool:
    return _table_exists_named(cur, TABLE)


def refresh_coverage_cells(
    conn: Any,
    *,
    freshness_hours: int = 24,
    bucket_minutes: int = 60,
    cell_size_degrees: float = 2.5,
) -> dict[str, Any]:
    """Persist viewport-friendly open AIS density cells from recent observations."""
    with conn.cursor() as cur:
        if not _table_exists_named(cur, "coverage_cells"):
            return {
                "status": "skipped",
                "reason": "coverage_cells missing — start oil-live-intel to apply migration 017",
                "upserted": 0,
            }
        cur.execute(
            """
            WITH recent AS (
              SELECT
                LOWER(COALESCE(NULLIF(source, ''), data_source)) AS source,
                COALESCE(NULLIF(source_type, ''), data_source) AS source_type,
                mmsi,
                lat::double precision AS lat,
                lng::double precision AS lng,
                EXTRACT(EPOCH FROM (now() - COALESCE(position_time, observed_at)))::int AS freshness_seconds
              FROM oil_vessel_position_observations
              WHERE COALESCE(position_time, observed_at) > now() - (%s || ' hours')::interval
            ),
            cells AS (
              SELECT
                FLOOR(lat / %s) * %s AS min_lat,
                FLOOR(lng / %s) * %s AS min_lng,
                source,
                source_type,
                COUNT(*)::int AS observation_count,
                COUNT(DISTINCT mmsi)::int AS vessel_count,
                MIN(freshness_seconds)::int AS freshness_seconds
              FROM recent
              GROUP BY 1, 2, 3, 4
            )
            INSERT INTO coverage_cells (
              cell_id, min_lat, min_lng, max_lat, max_lng, bucket_start,
              bucket_minutes, source, source_type, observation_count,
              vessel_count, freshness_seconds, coverage_quality, confidence,
              metadata, updated_at
            )
            SELECT
              CONCAT(ROUND(min_lat::numeric, 2)::text, ':', ROUND(min_lng::numeric, 2)::text),
              min_lat,
              min_lng,
              min_lat + %s,
              min_lng + %s,
              date_trunc('hour', now()),
              %s,
              source,
              source_type,
              observation_count,
              vessel_count,
              freshness_seconds,
              CASE
                WHEN vessel_count >= 50 THEN 'strong'
                WHEN vessel_count >= 10 THEN 'fair'
                WHEN vessel_count > 0 THEN 'sparse'
                ELSE 'gap'
              END,
              CASE
                WHEN vessel_count >= 50 THEN 0.85
                WHEN vessel_count >= 10 THEN 0.65
                WHEN vessel_count > 0 THEN 0.35
                ELSE 0.1
              END,
              jsonb_build_object('freshness_hours', %s, 'cell_size_degrees', %s),
              now()
            FROM cells
            ON CONFLICT (cell_id, bucket_start, source) DO UPDATE SET
              observation_count = EXCLUDED.observation_count,
              vessel_count = EXCLUDED.vessel_count,
              freshness_seconds = EXCLUDED.freshness_seconds,
              coverage_quality = EXCLUDED.coverage_quality,
              confidence = EXCLUDED.confidence,
              metadata = EXCLUDED.metadata,
              updated_at = now()
            """,
            (
                freshness_hours,
                cell_size_degrees,
                cell_size_degrees,
                cell_size_degrees,
                cell_size_degrees,
                cell_size_degrees,
                cell_size_degrees,
                bucket_minutes,
                freshness_hours,
                cell_size_degrees,
            ),
        )
        return {
            "status": "ok",
            "upserted": cur.rowcount,
            "freshness_hours": freshness_hours,
            "bucket_minutes": bucket_minutes,
            "cell_size_degrees": cell_size_degrees,
        }


def upsert_observation(
    conn: Any,
    mmsi: int,
    data_source: str,
    source_record_id: str,
    lat: float,
    lng: float,
    observed_at: datetime,
    *,
    sog: Optional[float] = None,
    cog: Optional[float] = None,
    vessel_name: Optional[str] = None,
    imo: Optional[str] = None,
    source_type: Optional[str] = None,
    received_at: Optional[datetime] = None,
    confidence: Optional[float] = None,
    source_url: Optional[str] = None,
    raw: Optional[dict[str, Any]] = None,
) -> None:
    """Upsert one observation; ON CONFLICT updates only the same (data_source, source_record_id)."""
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)
    if received_at is None:
        received_at = datetime.now(timezone.utc)
    elif received_at.tzinfo is None:
        received_at = received_at.replace(tzinfo=timezone.utc)
    freshness_seconds = max(0, int((received_at - observed_at).total_seconds()))
    normalized_source_type = source_type or data_source
    normalized_confidence = 0.5 if confidence is None else max(0.0, min(1.0, float(confidence)))
    payload = raw if raw is not None else {}
    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO {TABLE} (
              mmsi, data_source, source_record_id, lat, lng, sog, cog,
              vessel_name, imo, source, source_type, observed_at, position_time,
              received_at, freshness_seconds, confidence, source_url,
              geom, raw
            ) VALUES (
              %s, %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s,
              ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s
            )
            ON CONFLICT (data_source, source_record_id) DO UPDATE SET
              mmsi = EXCLUDED.mmsi,
              lat = EXCLUDED.lat,
              lng = EXCLUDED.lng,
              sog = EXCLUDED.sog,
              cog = EXCLUDED.cog,
              vessel_name = EXCLUDED.vessel_name,
              imo = EXCLUDED.imo,
              source = EXCLUDED.source,
              source_type = EXCLUDED.source_type,
              observed_at = EXCLUDED.observed_at,
              position_time = EXCLUDED.position_time,
              received_at = EXCLUDED.received_at,
              freshness_seconds = EXCLUDED.freshness_seconds,
              confidence = EXCLUDED.confidence,
              source_url = EXCLUDED.source_url,
              geom = EXCLUDED.geom,
              raw = EXCLUDED.raw,
              ingested_at = now()
            """,
            (
                mmsi,
                data_source,
                source_record_id,
                lat,
                lng,
                sog,
                cog,
                vessel_name,
                imo,
                data_source,
                normalized_source_type,
                observed_at,
                observed_at,
                received_at,
                freshness_seconds,
                normalized_confidence,
                source_url,
                lng,
                lat,
                _pg_json(payload),
            ),
        )


def mirror_maritime_redis_snapshot(conn: Any, limit: int = 5000) -> dict[str, Any]:
    """
    Mirror latest maritime-worker Redis snapshot into observations (data_source=maritime_redis).
    Does not touch rows from other data_source values.
    """
    try:
        from backend.services.maritime_snapshot import get_global_maritime_snapshot
    except ImportError:
        from services.maritime_snapshot import get_global_maritime_snapshot

    with conn.cursor() as cur:
        if not _table_exists(cur):
            return {
                "status": "skipped",
                "reason": f"{TABLE} missing — start oil-live-intel to apply migration 014",
                "upserted": 0,
            }

    payload = get_global_maritime_snapshot()
    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not rows:
        return {"status": "skipped", "reason": "redis_empty", "upserted": 0}

    upserted = 0
    for row in list(rows)[: max(1, limit)]:
        if not isinstance(row, dict):
            continue
        mmsi = _parse_mmsi(row.get("mmsi"))
        lat = row.get("lat")
        lng = row.get("lng")
        if mmsi is None or lat is None or lng is None:
            continue
        try:
            lat_f = float(lat)
            lng_f = float(lng)
        except (TypeError, ValueError):
            continue
        observed_at = _parse_observed_at(row)
        sog_f = _parse_optional_float(row.get("speed_knots") or row.get("speed"))
        cog_f = _parse_optional_float(row.get("course") or row.get("course_over_ground"))
        source_record_id = f"redis:{mmsi}"
        upsert_observation(
            conn,
            mmsi,
            DATA_SOURCE_MARITIME_REDIS,
            source_record_id,
            lat_f,
            lng_f,
            observed_at,
            sog=sog_f,
            cog=cog_f,
            vessel_name=row.get("vessel_name"),
            imo=row.get("imo"),
            source_type=SOURCE_TYPE_COMMUNITY_AIS,
            confidence=0.55,
            source_url=AISSTREAM_DOC_URL,
            raw={
                "snapshot": row,
                "coverage_note": (
                    "Mirrored from the open maritime-worker snapshot; open AIS is partial "
                    "and does not prove supplier/receiver."
                ),
            },
        )
        upserted += 1

    coverage_result = refresh_coverage_cells(conn)

    return {"status": "ok", "upserted": upserted, "limit": limit, "coverage_cells": coverage_result}
