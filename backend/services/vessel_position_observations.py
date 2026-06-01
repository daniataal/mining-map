"""Multi-source vessel position observations — merge never override across sources."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

try:
    from psycopg2.extras import Json, execute_values
except ImportError:
    Json = None  # type: ignore
    execute_values = None  # type: ignore

TABLE = "oil_vessel_position_observations"
DATA_SOURCE_MARITIME_REDIS = "maritime_redis"
SOURCE_TYPE_COMMUNITY_AIS = "community_coastal_ais"
AISSTREAM_DOC_URL = "https://aisstream.io/documentation.html"

_UPSERT_SQL = f"""
INSERT INTO {TABLE} (
  mmsi, data_source, source_record_id, lat, lng, sog, cog,
  vessel_name, imo, source, source_type, observed_at, position_time,
  received_at, freshness_seconds, confidence, source_url,
  geom, raw
) VALUES %s
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
"""


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


def _normalize_observed_at(observed_at: datetime) -> datetime:
    if observed_at.tzinfo is None:
        return observed_at.replace(tzinfo=timezone.utc)
    return observed_at.astimezone(timezone.utc)


def _observation_tuple(
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
) -> tuple[Any, ...]:
    observed_at = _normalize_observed_at(observed_at)
    if received_at is None:
        received_at = datetime.now(timezone.utc)
    elif received_at.tzinfo is None:
        received_at = received_at.replace(tzinfo=timezone.utc)
    else:
        received_at = received_at.astimezone(timezone.utc)
    freshness_seconds = max(0, int((received_at - observed_at).total_seconds()))
    normalized_source_type = source_type or data_source
    normalized_confidence = 0.5 if confidence is None else max(0.0, min(1.0, float(confidence)))
    payload = raw if raw is not None else {}
    return (
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
    )


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


def batch_upsert_observations(conn: Any, rows: list[dict[str, Any]]) -> int:
    """Upsert many observations in one execute_values call."""
    if not rows:
        return 0
    values = [
        _observation_tuple(
            row["mmsi"],
            row["data_source"],
            row["source_record_id"],
            row["lat"],
            row["lng"],
            row["observed_at"],
            sog=row.get("sog"),
            cog=row.get("cog"),
            vessel_name=row.get("vessel_name"),
            imo=row.get("imo"),
            source_type=row.get("source_type"),
            received_at=row.get("received_at"),
            confidence=row.get("confidence"),
            source_url=row.get("source_url"),
            raw=row.get("raw"),
        )
        for row in rows
    ]
    template = (
        "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
        "ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s)"
    )
    with conn.cursor() as cur:
        if execute_values is not None:
            execute_values(cur, _UPSERT_SQL, values, template=template, page_size=len(values))
        else:
            for value in values:
                cur.execute(
                    _UPSERT_SQL.replace(" VALUES %s", " VALUES " + template),
                    value,
                )
    return len(values)


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
    batch_upsert_observations(
        conn,
        [
            {
                "mmsi": mmsi,
                "data_source": data_source,
                "source_record_id": source_record_id,
                "lat": lat,
                "lng": lng,
                "observed_at": observed_at,
                "sog": sog,
                "cog": cog,
                "vessel_name": vessel_name,
                "imo": imo,
                "source_type": source_type,
                "received_at": received_at,
                "confidence": confidence,
                "source_url": source_url,
                "raw": raw,
            }
        ],
    )


def mirror_maritime_redis_snapshot(conn: Any, limit: int = 5000) -> dict[str, Any]:
    """Retired — live AIS is ingested by oil-live-intel-worker into oil_ais_positions."""
    _ = (conn, limit)
    return {
        "status": "retired",
        "reason": "Python maritime-worker Redis snapshot writer removed",
        "upserted": 0,
    }
