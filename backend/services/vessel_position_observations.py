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


def _table_exists(cur: Any) -> bool:
    cur.execute(
        """
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = %s
        )
        """,
        (TABLE,),
    )
    row = cur.fetchone()
    return bool(row[0]) if row else False


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
    raw: Optional[dict[str, Any]] = None,
) -> None:
    """Upsert one observation; ON CONFLICT updates only the same (data_source, source_record_id)."""
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)
    payload = raw if raw is not None else {}
    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO {TABLE} (
              mmsi, data_source, source_record_id, lat, lng, sog, cog,
              vessel_name, observed_at, raw
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (data_source, source_record_id) DO UPDATE SET
              mmsi = EXCLUDED.mmsi,
              lat = EXCLUDED.lat,
              lng = EXCLUDED.lng,
              sog = EXCLUDED.sog,
              cog = EXCLUDED.cog,
              vessel_name = EXCLUDED.vessel_name,
              observed_at = EXCLUDED.observed_at,
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
                observed_at,
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
        sog = row.get("speed_knots") or row.get("speed")
        try:
            sog_f = float(sog) if sog is not None else None
        except (TypeError, ValueError):
            sog_f = None
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
            vessel_name=row.get("vessel_name"),
            raw={"snapshot": row},
        )
        upserted += 1

    return {"status": "ok", "upserted": upserted, "limit": limit}
