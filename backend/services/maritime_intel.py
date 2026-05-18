from __future__ import annotations

import asyncio
import csv
import json
import math
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.parse import quote_plus, urlencode
from urllib.request import Request, urlopen


AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"
AISSTREAM_PERSIAN_GULF_ISSUE_URL = "https://github.com/aisstream/aisstream/issues/17"
GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
UNLOCODE_CSV_URL = "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv"
WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql"

REQUEST_TIMEOUT_SECONDS = 12
UNLOCODE_CACHE_TTL_SECONDS = 60 * 60 * 24
AIS_CACHE_TTL_SECONDS = 60
AIS_DEFAULT_MAX_VESSELS = 1000
AIS_MAX_VESSELS = max(1000, int(os.getenv("AIS_MAX_VESSELS", "15000")))
AIS_DEFAULT_CAPTURE_WINDOW_SECONDS = 10
AIS_MIN_CAPTURE_WINDOW_SECONDS = 4
AIS_MAX_CAPTURE_WINDOW_SECONDS = max(
    18,
    int(os.getenv("AIS_MAX_CAPTURE_WINDOW_SECONDS", "30")),
)
AIS_MAX_VIEWPORT_WIDTH_DEGREES = 90.0
AIS_MAX_VIEWPORT_HEIGHT_DEGREES = 55.0
AIS_MAX_VIEWPORT_SAMPLE_REGIONS = 6
MARITIME_WORKER_WATCH_MODE = os.getenv("MARITIME_WORKER_WATCH_MODE", "all_regions").strip().lower()
MARITIME_AIS_MAX_REGIONS = max(0, int(os.getenv("MARITIME_AIS_MAX_REGIONS", "0")))
MARITIME_SNAPSHOT_TTL_SECONDS = int(os.getenv("MARITIME_SNAPSHOT_TTL_SECONDS", "300"))
MARITIME_SNAPSHOT_RETENTION_SECONDS = int(os.getenv("MARITIME_SNAPSHOT_RETENTION_SECONDS", str(60 * 60 * 24)))
MARITIME_WORKER_STATUS_ID = "aisstream"
MARITIME_MEMORY_CACHE_TTL_SECONDS = int(os.getenv("MARITIME_MEMORY_CACHE_TTL_SECONDS", "10"))
MARITIME_MEMORY_CACHE_MAX_VESSELS = int(os.getenv("MARITIME_MEMORY_CACHE_MAX_VESSELS", "10000"))
MARITIME_GULF_SUPPLEMENT_MAX_VESSELS = max(
    500,
    int(os.getenv("MARITIME_GULF_SUPPLEMENT_MAX_VESSELS", "4000")),
)
MARITIME_GULF_SUPPLEMENT_WINDOW_SECONDS = max(
    AIS_MIN_CAPTURE_WINDOW_SECONDS,
    int(os.getenv("MARITIME_GULF_SUPPLEMENT_WINDOW_SECONDS", "18")),
)
MARITIME_ALWAYS_ON_REGION_IDS = tuple(
    item.strip()
    for item in os.getenv(
        "MARITIME_ALWAYS_ON_REGION_IDS",
        "persian_gulf,arabian_gulf,malacca,east_mediterranean",
    ).split(",")
    if item.strip()
)
# Core Persian Gulf + Strait of Hormuz (south, west, north, east).
PERSIAN_GULF_CORE_BBOX = (22.0, 47.0, 30.5, 60.0)

# Africa-adjacent reference boxes for sparse-feed demo seeding (south, west, north, east).
GULF_OF_GUINEA_DEMO_BBOX = (0.0, -3.5, 6.5, 5.5)
MOZAMBIQUE_CHANNEL_DEMO_BBOX = (-24.0, 34.5, -11.0, 47.5)
RED_SEA_SOUTH_DEMO_BBOX = (12.5, 37.0, 19.5, 43.5)
HORN_OF_AFRICA_DEMO_BBOX = (2.0, 41.0, 13.5, 52.0)
EAST_AFRICA_INDIAN_DEMO_BBOX = (-11.5, 39.0, 4.5, 50.5)

try:
    MARITIME_COASTAL_DEMO_SPARSE_THRESHOLD = max(
        1,
        int(os.getenv("MARITIME_COASTAL_DEMO_SPARSE_THRESHOLD", "12")),
    )
except (TypeError, ValueError):
    MARITIME_COASTAL_DEMO_SPARSE_THRESHOLD = 12

# Curated coastal-demo regions (excluding Hormuz here — handled via PERSIAN_GULF_CORE_BBOX + Gulf seed file).
MARITIME_COASTAL_DEMO_AFRICA_SPECS: tuple[dict[str, Any], ...] = (
    {
        "id": "gulf_of_guinea",
        "label": "Gulf of Guinea",
        "bbox": GULF_OF_GUINEA_DEMO_BBOX,
        "id_prefix": "demo:guinea",
        "vessel_name_prefix": "Guinea Demo",
        "source_label": "Gulf of Guinea demo (synthetic)",
        "mmsi_start": 998_010_000,
        "prng_salt": 11_035,
    },
    {
        "id": "mozambique_channel",
        "label": "Mozambique Channel",
        "bbox": MOZAMBIQUE_CHANNEL_DEMO_BBOX,
        "id_prefix": "demo:mozambique",
        "vessel_name_prefix": "Mozambique Demo",
        "source_label": "Mozambique Channel demo (synthetic)",
        "mmsi_start": 998_020_000,
        "prng_salt": 22_071,
    },
    {
        "id": "red_sea_south",
        "label": "Red Sea (south)",
        "bbox": RED_SEA_SOUTH_DEMO_BBOX,
        "id_prefix": "demo:red_sea_south",
        "vessel_name_prefix": "Red Sea Demo",
        "source_label": "Red Sea south demo (synthetic)",
        "mmsi_start": 998_030_000,
        "prng_salt": 33_103,
    },
    {
        "id": "horn_of_africa",
        "label": "Horn of Africa / Gulf of Aden",
        "bbox": HORN_OF_AFRICA_DEMO_BBOX,
        "id_prefix": "demo:horn",
        "vessel_name_prefix": "Horn Demo",
        "source_label": "Horn of Africa demo (synthetic)",
        "mmsi_start": 998_040_000,
        "prng_salt": 44_137,
    },
    {
        "id": "east_africa_indian",
        "label": "East Africa / Indian Ocean approaches",
        "bbox": EAST_AFRICA_INDIAN_DEMO_BBOX,
        "id_prefix": "demo:east_africa",
        "vessel_name_prefix": "E Africa Demo",
        "source_label": "East Africa coast demo (synthetic)",
        "mmsi_start": 998_050_000,
        "prng_salt": 55_171,
    },
)

_maritime_memory_cache: dict[str, Any] = {
    "loaded_at": 0.0,
    "rows": [],
    "status": None,
}

# Curated fallback regions used when a viewport is absent or too wide to watch
# honestly as a single AIS subscription. Bboxes are (south, west, north, east).
AISSTREAM_WATCH_REGIONS = [
    {
        "id": "persian_gulf",
        "label": "Persian Gulf and Strait of Hormuz",
        "bbox": PERSIAN_GULF_CORE_BBOX,
    },
    {
        "id": "arabian_gulf",
        "label": "Arabian Gulf (wide)",
        "bbox": (16.0, 46.0, 31.5, 60.0),
    },
    {"id": "red_sea_suez", "label": "Red Sea and Suez", "bbox": (12.0, 29.0, 32.5, 44.0)},
    {"id": "east_mediterranean", "label": "Mediterranean", "bbox": (30.0, -7.0, 46.0, 37.0)},
    {"id": "west_africa", "label": "West Africa offshore", "bbox": (-30.0, -20.0, 14.0, 20.0)},
    {"id": "south_africa_indian", "label": "South and East Africa coast", "bbox": (-40.0, 15.0, -5.0, 55.0)},
    {"id": "gulf_of_mexico", "label": "Gulf of Mexico and Caribbean", "bbox": (18.0, -98.0, 31.0, -79.0)},
    {"id": "north_sea", "label": "North Sea", "bbox": (50.0, -5.0, 62.0, 12.0)},
    {"id": "east_africa_arabian_sea", "label": "East Africa and Arabian Sea", "bbox": (-6.0, 38.0, 23.0, 78.0)},
    {"id": "malacca", "label": "Malacca and Singapore", "bbox": (-8.0, 95.0, 12.0, 108.0)},
    {"id": "south_china_sea", "label": "South China Sea", "bbox": (1.0, 105.0, 24.0, 122.0)},
    {"id": "northeast_asia", "label": "Northeast Asia", "bbox": (30.0, 122.0, 45.0, 145.0)},
    {"id": "brazil_offshore", "label": "Brazil offshore", "bbox": (-35.0, -55.0, 5.0, -25.0)},
]

OIL_PORT_KEYWORDS = (
    "oil",
    "gas",
    "lng",
    "lpg",
    "petro",
    "petrol",
    "terminal",
    "offshore",
    "energy",
    "refinery",
)

UNLOCODE_OFFICIAL_SOURCE_URL = "https://unece.org/trade/cefact/UNLOCODE-Download"

_unlocode_cache: dict[str, Any] = {"loaded_at": 0.0, "rows": []}
_ais_cache: dict[str, Any] = {"items": {}}

_COORD_RE = re.compile(
    r"^(?P<lat_deg>\d{2})(?P<lat_min>\d{2})(?P<lat_hem>[NS])\s+(?P<lon_deg>\d{3})(?P<lon_min>\d{2})(?P<lon_hem>[EW])$"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return " ".join(value.split()).strip()
    return str(value).strip()


def _normalize_token(value: Any) -> str:
    text = _clean_text(value).lower()
    if not text:
        return ""
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def _clip(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _normalize_requested_bbox(
    bbox: Optional[tuple[float, float, float, float]],
) -> Optional[tuple[float, float, float, float]]:
    if bbox is None:
        return None
    try:
        south, west, north, east = (float(part) for part in bbox)
    except (TypeError, ValueError):
        return None

    south = _clip(south, -85.0, 85.0)
    north = _clip(north, -85.0, 85.0)
    west = _clip(west, -180.0, 180.0)
    east = _clip(east, -180.0, 180.0)

    if north <= south or east <= west:
        return None

    return (
        round(south, 4),
        round(west, 4),
        round(north, 4),
        round(east, 4),
    )


def _bbox_to_ais_box(bbox: tuple[float, float, float, float]) -> list[list[float]]:
    south, west, north, east = bbox
    return [[north, west], [south, east]]


def _bbox_intersects(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> bool:
    left_south, left_west, left_north, left_east = left
    right_south, right_west, right_north, right_east = right
    return not (
        left_east < right_west
        or right_east < left_west
        or left_north < right_south
        or right_north < left_south
    )


def _row_in_bbox(row: dict[str, Any], bbox: tuple[float, float, float, float]) -> bool:
    lat = row.get("lat")
    lng = row.get("lng")
    if lat is None or lng is None:
        return False
    south, west, north, east = bbox
    return south <= float(lat) <= north and west <= float(lng) <= east


def filter_maritime_rows_by_bbox(
    rows: list[dict[str, Any]],
    bbox: Optional[tuple[float, float, float, float]],
) -> list[dict[str, Any]]:
    normalized_bbox = _normalize_requested_bbox(bbox)
    if normalized_bbox is None:
        return list(rows)
    return [row for row in rows if _row_in_bbox(row, normalized_bbox)]


def count_maritime_rows_in_bbox(
    rows: list[dict[str, Any]],
    bbox: tuple[float, float, float, float],
) -> int:
    return len(filter_maritime_rows_by_bbox(rows, bbox))


def _north_sea_reference_bbox() -> tuple[float, float, float, float]:
    region = _region_by_id("north_sea")
    if region is not None:
        return region["bbox"]
    return (50.0, -5.0, 62.0, 12.0)


def _sort_maritime_rows(rows: list[dict[str, Any]], vessel_scope: str) -> list[dict[str, Any]]:
    normalized_scope = _normalize_vessel_scope(vessel_scope)
    if normalized_scope == "oil_tankers":
        return sorted(
            rows,
            key=lambda row: (
                -petroleum_vessel_priority(row.get("ship_type_code"), row.get("ship_type_label")),
                str(row.get("last_seen_at") or row.get("observed_at") or ""),
            ),
            reverse=True,
        )
    return sorted(
        rows,
        key=lambda row: str(row.get("last_seen_at") or row.get("observed_at") or ""),
        reverse=True,
    )


def _refresh_maritime_memory_cache(conn) -> None:
    from psycopg2.extras import RealDictCursor

    ensure_maritime_tables(conn)
    max_rows = max(1, min(int(MARITIME_MEMORY_CACHE_MAX_VESSELS), AIS_MAX_VESSELS * 2))
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            f"""
            SELECT
                mmsi,
                vessel_name,
                lat,
                lng,
                observed_at,
                source_label,
                source_url,
                ship_type_code,
                ship_type_label,
                payload,
                last_seen_at
            FROM maritime_vessel_snapshots
            WHERE last_seen_at >= NOW() - (%s * INTERVAL '1 second')
            ORDER BY last_seen_at DESC
            LIMIT %s
            """,
            (MARITIME_SNAPSHOT_RETENTION_SECONDS, max_rows),
        )
        rows = [dict(row) for row in cur.fetchall()]
        cur.execute(
            """
            SELECT status, source, last_attempt_at, last_success_at, last_error, snapshot_count, metadata
            FROM maritime_ingest_status
            WHERE id = %s
            """,
            (MARITIME_WORKER_STATUS_ID,),
        )
        status_row = cur.fetchone()
    conn.commit()
    _maritime_memory_cache["loaded_at"] = time.time()
    _maritime_memory_cache["rows"] = rows
    _maritime_memory_cache["status"] = dict(status_row) if status_row else None


def invalidate_maritime_memory_cache() -> None:
    _maritime_memory_cache["loaded_at"] = 0.0
    _maritime_memory_cache["rows"] = []
    _maritime_memory_cache["status"] = None


def _normalize_vessel_scope(scope: str) -> str:
    return "all_vessels" if _clean_text(scope).lower() == "all_vessels" else "oil_tankers"


def petroleum_vessel_priority(ship_type_code: Any, ship_type_label: Any) -> int:
    """Higher score = more relevant for oil/gas maritime workflows (sort key, not a hard filter)."""
    try:
        code = int(ship_type_code)
    except (TypeError, ValueError):
        code = None
    if code is not None and 80 <= code <= 89:
        return 100
    label = _normalize_token(ship_type_label)
    if not label:
        return 0
    if any(term in label for term in ("tanker", "crude", "chemical", "lng", "lpg", "petroleum", "oil", "gas")):
        return 80
    if "cargo" in label:
        return 20
    return 0


def _ship_matches_scope(ship_type_label: str, vessel_scope: str) -> bool:
    # Scope no longer excludes vessel types; petroleum focus is applied via sort priority.
    return True


def _vessel_scope_order_sql(vessel_scope: str) -> str:
    normalized = _normalize_vessel_scope(vessel_scope)
    if normalized == "all_vessels":
        return "last_seen_at DESC, observed_at DESC NULLS LAST"
    return """
        CASE
            WHEN ship_type_code BETWEEN 80 AND 89 THEN 0
            WHEN lower(coalesce(ship_type_label, '')) LIKE '%tanker%' THEN 1
            WHEN lower(coalesce(ship_type_label, '')) ~ '(crude|chemical|lng|lpg|petroleum|oil|gas)' THEN 2
            ELSE 9
        END,
        last_seen_at DESC,
        observed_at DESC NULLS LAST
    """


def _parse_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        # Some upstream payloads include values like "... +0000 UTC" which are
        # valid timestamps semantically but not valid for PostgreSQL casts.
        normalized = re.sub(r"\s+UTC$", "", raw, flags=re.IGNORECASE)
        try:
            parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            for fmt in ("%Y-%m-%d %H:%M:%S %z", "%Y-%m-%dT%H:%M:%S %z"):
                try:
                    parsed = datetime.strptime(normalized, fmt)
                    return parsed.astimezone(timezone.utc)
                except ValueError:
                    continue
            return None
    return None


def _seconds_since(value: Any) -> Optional[int]:
    parsed = _parse_datetime(value)
    if parsed is None:
        return None
    return max(0, int((datetime.now(timezone.utc) - parsed).total_seconds()))


def _iso_datetime(value: Any) -> Any:
    parsed = _parse_datetime(value)
    if parsed is None:
        return value
    return parsed.isoformat()


def _db_connect():
    import psycopg2

    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        return psycopg2.connect(database_url, connect_timeout=5)
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "mining_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "password"),
        connect_timeout=5,
    )


def _maintenance_db_connect():
    import psycopg2

    database_url = os.getenv("DATABASE_URL", "").strip()
    maintenance_name = os.getenv("DB_MAINTENANCE_NAME", "postgres")
    if database_url:
        parsed = urlparse(database_url)
        maintenance_url = urlunparse(parsed._replace(path=f"/{maintenance_name}"))
        return psycopg2.connect(maintenance_url, connect_timeout=5)
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=maintenance_name,
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "password"),
        connect_timeout=5,
    )


def ensure_maritime_database_exists() -> None:
    import psycopg2
    from psycopg2 import sql

    database_url = os.getenv("DATABASE_URL", "").strip()
    db_name = os.getenv("DB_NAME", "mining_db")
    if database_url:
        parsed = urlparse(database_url)
        db_name = parsed.path.lstrip("/") or db_name

    conn = _maintenance_db_connect()
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
            if cur.fetchone():
                return
            try:
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db_name)))
            except psycopg2.Error as exc:
                if getattr(exc, "pgcode", None) == "42P04":
                    return
                raise
    finally:
        conn.close()


def ensure_maritime_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS maritime_vessel_snapshots (
                mmsi TEXT PRIMARY KEY,
                vessel_name TEXT,
                lat DOUBLE PRECISION NOT NULL,
                lng DOUBLE PRECISION NOT NULL,
                observed_at TIMESTAMPTZ,
                source_label TEXT,
                source_url TEXT,
                ship_type_code INTEGER,
                ship_type_label TEXT,
                payload JSONB NOT NULL,
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_maritime_vessel_snapshots_position
            ON maritime_vessel_snapshots (lat, lng);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_maritime_vessel_snapshots_seen
            ON maritime_vessel_snapshots (last_seen_at DESC);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_maritime_vessel_snapshots_type
            ON maritime_vessel_snapshots (ship_type_label);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS maritime_ingest_status (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                source TEXT,
                last_attempt_at TIMESTAMPTZ,
                last_success_at TIMESTAMPTZ,
                last_error TEXT,
                snapshot_count INTEGER DEFAULT 0,
                metadata JSONB,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )


def _build_stored_feed_response(
    *,
    rows: list[dict[str, Any]],
    status: Optional[dict[str, Any]],
    max_vessels: int,
    offset: int,
    total_available: int,
    capture_window_seconds: int,
    vessel_scope: str,
    bbox: Optional[tuple[float, float, float, float]],
) -> dict[str, Any]:
    normalized_scope = _normalize_vessel_scope(vessel_scope)
    normalized_bbox = _normalize_requested_bbox(bbox)
    plan = _build_ais_subscription_plan(normalized_bbox)
    vessels = []
    latest_seen = None
    for row in rows[:max_vessels]:
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        vessel = dict(payload)
        vessel.update(
            {
                "id": payload.get("id") or f"ais:{row.get('mmsi')}",
                "mmsi": row.get("mmsi"),
                "vessel_name": row.get("vessel_name") or payload.get("vessel_name") or f"MMSI {row.get('mmsi')}",
                "lat": row.get("lat"),
                "lng": row.get("lng"),
                "observed_at": _iso_datetime(row.get("observed_at") or payload.get("observed_at")),
                "source_label": row.get("source_label") or payload.get("source_label") or "AISStream",
                "source_url": row.get("source_url") or payload.get("source_url"),
                "ship_type_code": row.get("ship_type_code"),
                "ship_type_label": row.get("ship_type_label") or payload.get("ship_type_label"),
                "last_seen_at": _iso_datetime(row.get("last_seen_at")),
            }
        )
        vessels.append(vessel)
        parsed_seen = _parse_datetime(row.get("last_seen_at") or row.get("observed_at"))
        if parsed_seen is not None and (latest_seen is None or parsed_seen > latest_seen):
            latest_seen = parsed_seen

    last_success_at = (status or {}).get("last_success_at")
    freshness_anchor = latest_seen or _parse_datetime(last_success_at)
    snapshot_age_seconds = _seconds_since(freshness_anchor)
    is_stale = snapshot_age_seconds is None or snapshot_age_seconds > MARITIME_SNAPSHOT_TTL_SECONDS

    limitations = []
    if plan.get("geography_note"):
        limitations.append(str(plan["geography_note"]))
    if normalized_scope == "oil_tankers":
        limitations.append(
            "Oil-focused scope prioritizes tankers and petroleum-relevant AIS types; other vessels remain visible when within the cap."
        )
    else:
        limitations.append(
            "All-vessels mode is capped by the stored AIS snapshot and requested viewport for performance."
        )
    if is_stale:
        limitations.append(
            "Persisted AIS snapshots are stale or unavailable; check the maritime-worker container and AISSTREAM_API_KEY."
        )
    limitations.append(
        "AIS ownership/operator enrichment depends on whether the MMSI or IMO can be matched in open sources such as Wikidata."
    )

    metadata = (status or {}).get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}

    geography_mode = metadata.get("geography_mode") or plan.get("geography_mode")
    region_labels = metadata.get("region_labels") or plan.get("region_labels") or []
    effective_bbox_count = metadata.get("effective_bbox_count")
    if effective_bbox_count is None:
        effective_bbox_count = len(plan.get("boxes") or [])

    returned_count = len(vessels)
    cap_applied = bool(total_available > (offset + returned_count))
    return {
        "vessels": vessels,
        "source": "AISStream persisted snapshot",
        "data_as_of": (freshness_anchor.isoformat() if freshness_anchor else _now_iso()),
        "live_positions_enabled": not is_stale,
        "limitations": limitations,
        "scope": normalized_scope,
        "capture_window_seconds": capture_window_seconds,
        "max_vessels": max_vessels,
        "offset": offset,
        "total_available": total_available,
        "returned_count": returned_count,
        "cap_applied": cap_applied,
        "geography_mode": geography_mode,
        "geography_note": plan.get("geography_note"),
        "requested_bbox": plan.get("requested_bbox"),
        "effective_bbox_count": effective_bbox_count,
        "region_labels": region_labels,
        "cached": True,
        "stale": is_stale,
        "snapshot_age_seconds": snapshot_age_seconds,
        "stale_after_seconds": MARITIME_SNAPSHOT_TTL_SECONDS,
        "worker": {
            "status": (status or {}).get("status") or "unknown",
            "source": (status or {}).get("source") or "AISStream",
            "last_attempt_at": _iso_datetime((status or {}).get("last_attempt_at")),
            "last_success_at": _iso_datetime(last_success_at),
            "last_error": (status or {}).get("last_error"),
            "snapshot_count": (status or {}).get("snapshot_count") or 0,
            "metadata": metadata,
        },
    }


def _resolve_worker_watch_mode() -> str:
    mode = os.getenv("MARITIME_WORKER_WATCH_MODE", MARITIME_WORKER_WATCH_MODE).strip().lower()
    if mode in {"global", "all_regions", "default_regions", "rotating"}:
        return mode
    return "all_regions"


def _worker_region_batch_size() -> int:
    if MARITIME_AIS_MAX_REGIONS > 0:
        return min(MARITIME_AIS_MAX_REGIONS, len(AISSTREAM_WATCH_REGIONS))
    return len(AISSTREAM_WATCH_REGIONS)


def _region_by_id(region_id: str) -> Optional[dict[str, Any]]:
    for region in AISSTREAM_WATCH_REGIONS:
        if region.get("id") == region_id:
            return region
    return None


def _dedupe_watch_regions(regions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for region in regions:
        region_id = _clean_text(region.get("id"))
        if not region_id or region_id in seen:
            continue
        seen.add(region_id)
        deduped.append(region)
    return deduped


def _always_on_watch_regions() -> list[dict[str, Any]]:
    regions: list[dict[str, Any]] = []
    for region_id in MARITIME_ALWAYS_ON_REGION_IDS:
        region = _region_by_id(region_id)
        if region is not None:
            regions.append(region)
    return regions


def _with_always_on_regions(regions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return _dedupe_watch_regions(_always_on_watch_regions() + list(regions))


def _regions_for_worker_watch_mode(mode: str) -> list[dict[str, Any]]:
    regions = list(AISSTREAM_WATCH_REGIONS)
    if mode == "global":
        return [{"id": "global", "label": "Global AIS watch", "bbox": (-85.0, -180.0, 85.0, 180.0)}]
    if mode == "all_regions":
        return _with_always_on_regions(regions)
    if mode == "rotating":
        batch_size = max(1, _worker_region_batch_size())
        batch_count = max(1, math.ceil(len(regions) / batch_size))
        interval = max(15, int(os.getenv("MARITIME_WORKER_INTERVAL_SECONDS", "30")))
        batch_index = int(time.time() // interval) % batch_count
        start = batch_index * batch_size
        sampled = regions[start : start + batch_size]
        return _with_always_on_regions(sampled or regions[:batch_size])
    return _with_always_on_regions(regions[:AIS_MAX_VIEWPORT_SAMPLE_REGIONS])


def _build_ais_subscription_plan(
    viewport_bbox: Optional[tuple[float, float, float, float]] = None,
    *,
    worker_ingest: bool = False,
) -> dict[str, Any]:
    requested_bbox = _normalize_requested_bbox(viewport_bbox)
    if requested_bbox is not None:
        south, west, north, east = requested_bbox
        width = east - west
        height = north - south
        if width <= AIS_MAX_VIEWPORT_WIDTH_DEGREES and height <= AIS_MAX_VIEWPORT_HEIGHT_DEGREES:
            return {
                "boxes": [_bbox_to_ais_box(requested_bbox)],
                "requested_bbox": list(requested_bbox),
                "geography_mode": "viewport_bbox",
                "geography_note": "Watching the current map viewport only.",
                "region_labels": [],
            }

        intersecting_regions = [
            region
            for region in AISSTREAM_WATCH_REGIONS
            if _bbox_intersects(requested_bbox, region["bbox"])
        ]
        if not intersecting_regions:
            intersecting_regions = AISSTREAM_WATCH_REGIONS
        sampled_regions = intersecting_regions[:AIS_MAX_VIEWPORT_SAMPLE_REGIONS]
        return {
            "boxes": [_bbox_to_ais_box(region["bbox"]) for region in sampled_regions],
            "requested_bbox": list(requested_bbox),
            "geography_mode": "sampled_viewport_regions",
            "geography_note": (
                "Viewport is very wide, so the watch samples curated maritime regions inside the current view "
                "instead of claiming every vessel globally."
            ),
            "region_labels": [region["label"] for region in sampled_regions],
        }

    if worker_ingest:
        watch_mode = _resolve_worker_watch_mode()
        sampled_regions = _regions_for_worker_watch_mode(watch_mode)
        notes = {
            "global": "Worker watches a single global AIS bounding box for maximum vessel density.",
            "all_regions": (
                "Worker watches all curated maritime regions (including West and East/South Africa) each cycle."
            ),
            "rotating": "Worker rotates through regional batches each cycle to stay within AISStream limits.",
            "default_regions": (
                "Worker watches the first curated maritime regions only; set MARITIME_WORKER_WATCH_MODE=all_regions for denser maps."
            ),
        }
        return {
            "boxes": [_bbox_to_ais_box(region["bbox"]) for region in sampled_regions],
            "requested_bbox": None,
            "geography_mode": watch_mode,
            "geography_note": notes.get(watch_mode, notes["all_regions"]),
            "region_labels": [region["label"] for region in sampled_regions],
        }

    sampled_regions = AISSTREAM_WATCH_REGIONS[:AIS_MAX_VIEWPORT_SAMPLE_REGIONS]
    return {
        "boxes": [_bbox_to_ais_box(region["bbox"]) for region in sampled_regions],
        "requested_bbox": None,
        "geography_mode": "default_regions",
        "geography_note": (
            "No viewport was supplied, so the watch falls back to curated maritime regions rather than an unbounded global feed."
        ),
        "region_labels": [region["label"] for region in sampled_regions],
    }


def _build_empty_ais_response(
    *,
    source: str,
    limitations: list[str],
    vessel_scope: str,
    capture_window_seconds: int,
    max_vessels: int,
    offset: int = 0,
    total_available: int = 0,
    returned_count: int = 0,
    cap_applied: bool = False,
    plan: dict[str, Any],
    live_positions_enabled: bool = False,
) -> dict[str, Any]:
    return {
        "vessels": [],
        "source": source,
        "data_as_of": _now_iso(),
        "live_positions_enabled": live_positions_enabled,
        "limitations": limitations,
        "scope": _normalize_vessel_scope(vessel_scope),
        "capture_window_seconds": capture_window_seconds,
        "max_vessels": max_vessels,
        "offset": offset,
        "total_available": total_available,
        "returned_count": returned_count,
        "cap_applied": cap_applied,
        "geography_mode": plan.get("geography_mode"),
        "geography_note": plan.get("geography_note"),
        "requested_bbox": plan.get("requested_bbox"),
        "effective_bbox_count": len(plan.get("boxes") or []),
        "region_labels": plan.get("region_labels") or [],
    }


def parse_unlocode_coordinates(value: str) -> tuple[Optional[float], Optional[float]]:
    raw = _clean_text(value)
    if not raw:
        return None, None
    match = _COORD_RE.match(raw)
    if not match:
        return None, None

    lat = int(match.group("lat_deg")) + int(match.group("lat_min")) / 60.0
    if match.group("lat_hem") == "S":
        lat *= -1

    lng = int(match.group("lon_deg")) + int(match.group("lon_min")) / 60.0
    if match.group("lon_hem") == "W":
        lng *= -1

    return lat, lng


def _is_port_row(function_code: str) -> bool:
    normalized = _clean_text(function_code)
    return bool(normalized) and normalized[0] == "1"


def _looks_energy_related(name: str, remarks: str) -> bool:
    haystack = f"{name} {remarks}".lower()
    return any(keyword in haystack for keyword in OIL_PORT_KEYWORDS)


def _country_port_role(name: str, remarks: str) -> str:
    if _looks_energy_related(name, remarks):
        return "energy_port"
    return "port"


def _fetch_text(url: str, timeout: int = REQUEST_TIMEOUT_SECONDS) -> str:
    req = Request(url, headers={"User-Agent": "mining-map-maritime-intel/1.0"})
    with urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8")


def _fetch_json(url: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    target_url = f"{url}?{urlencode(params)}" if params else url
    req = Request(
        target_url,
        headers={
            "Accept": "application/json",
            "User-Agent": "mining-map-maritime-intel/1.0",
        },
    )
    with urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


def _load_unlocode_ports(force_refresh: bool = False) -> list[dict[str, Any]]:
    age = time.time() - float(_unlocode_cache.get("loaded_at") or 0.0)
    if not force_refresh and _unlocode_cache.get("rows") and age < UNLOCODE_CACHE_TTL_SECONDS:
        return list(_unlocode_cache["rows"])

    try:
        csv_text = _fetch_text(UNLOCODE_CSV_URL)
        reader = csv.DictReader(csv_text.splitlines())
        rows: list[dict[str, Any]] = []
        for raw_row in reader:
            function_code = _clean_text(raw_row.get("Function"))
            if not _is_port_row(function_code):
                continue
            lat, lng = parse_unlocode_coordinates(_clean_text(raw_row.get("Coordinates")))
            if lat is None or lng is None:
                continue

            country_code = _clean_text(raw_row.get("Country")).upper()
            location = _clean_text(raw_row.get("Location")).upper()
            name = _clean_text(raw_row.get("Name"))
            remarks = _clean_text(raw_row.get("Remarks"))
            if not country_code or not location or not name:
                continue

            rows.append(
                {
                    "unlocode": f"{country_code}{location}",
                    "country_iso2": country_code,
                    "name": name,
                    "name_ascii": _clean_text(raw_row.get("NameWoDiacritics")) or name,
                    "subdivision": _clean_text(raw_row.get("Subdivision")) or None,
                    "status": _clean_text(raw_row.get("Status")) or None,
                    "function": function_code,
                    "remarks": remarks or None,
                    "lat": lat,
                    "lng": lng,
                    "role": _country_port_role(name, remarks),
                    "source_label": "UN/LOCODE",
                    "source_url": UNLOCODE_OFFICIAL_SOURCE_URL,
                }
            )

        _unlocode_cache["loaded_at"] = time.time()
        _unlocode_cache["rows"] = rows
        return list(rows)
    except Exception:
        return list(_unlocode_cache.get("rows") or [])


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_km = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)
    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_km * c


def find_nearest_ports(
    *,
    country_iso2: str = "",
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    rows = _load_unlocode_ports()
    if not rows:
        return []

    country_code = _clean_text(country_iso2).upper()
    scoped = [row for row in rows if not country_code or row["country_iso2"] == country_code]

    if lat is not None and lng is not None:
        enriched = []
        for row in scoped:
            distance = haversine_km(lat, lng, row["lat"], row["lng"])
            row_copy = dict(row)
            row_copy["distance_km"] = round(distance, 1)
            row_copy["confidence"] = 0.65 if row_copy["role"] == "energy_port" else 0.45
            enriched.append(row_copy)
        enriched.sort(key=lambda item: (item["distance_km"], item["name"]))
        return enriched[:limit]

    energy_first = sorted(
        scoped,
        key=lambda item: (0 if item["role"] == "energy_port" else 1, item["name"]),
    )
    results = []
    for row in energy_first[:limit]:
        row_copy = dict(row)
        row_copy["distance_km"] = None
        row_copy["confidence"] = 0.55 if row_copy["role"] == "energy_port" else 0.35
        results.append(row_copy)
    return results


def match_destination_to_port(destination: str, country_iso2: str = "") -> Optional[dict[str, Any]]:
    token = _normalize_token(destination)
    if not token:
        return None

    rows = _load_unlocode_ports()
    if not rows:
        return None

    country_code = _clean_text(country_iso2).upper()
    scoped = [row for row in rows if not country_code or row["country_iso2"] == country_code]
    if not scoped:
        scoped = rows

    best: tuple[float, dict[str, Any]] | None = None
    for row in scoped:
        tokens = {
            _normalize_token(row["name"]),
            _normalize_token(row["name_ascii"]),
            _normalize_token(row["unlocode"]),
        }
        score = 0.0
        if token in tokens:
            score = 1.0
        elif any(token in candidate or candidate in token for candidate in tokens if candidate):
            score = 0.82
        else:
            continue

        if best is None or score > best[0]:
            best = (score, row)

    if best is None:
        return None

    matched = dict(best[1])
    matched["matched_on"] = destination
    matched["confidence"] = best[0]
    return matched


def classify_ais_ship_type(type_code: Any) -> tuple[Optional[int], str]:
    try:
        code = int(type_code)
    except (TypeError, ValueError):
        return None, "Unknown"
    if 80 <= code <= 89:
        return code, "Tanker"
    if 70 <= code <= 79:
        return code, "Cargo"
    if 60 <= code <= 69:
        return code, "Passenger"
    return code, "Other"


def classify_evidence_type(title: str) -> str:
    normalized = _normalize_token(title)
    if any(term in normalized for term in ("buyer", "seller", "offtake", "supply deal", "purchase")):
        return "counterparty_signal"
    if any(term in normalized for term in ("sanction", "seized", "detained", "attack", "spill", "collision", "fire")):
        return "risk_signal"
    if any(term in normalized for term in ("tanker", "shipment", "cargo", "terminal", "port", "load", "loading", "discharge", "lng", "lpg")):
        return "shipment_signal"
    return "maritime_context"


def _build_gdelt_query(company: str, country: str, commodity: str, vessel_name: str) -> str:
    anchors = []
    if vessel_name:
        anchors.append(f'"{vessel_name}"')
    elif company:
        anchors.append(f'"{company}"')
    elif country:
        anchors.append(f'"{country}"')

    terms = ["(tanker OR vessel OR shipping OR terminal OR port OR cargo OR crude OR oil OR LNG OR LPG)"]
    commodity_token = _normalize_token(commodity)
    if commodity_token:
        if "gas" in commodity_token or "lng" in commodity_token or "lpg" in commodity_token:
            terms.append("(gas OR LNG OR LPG)")
        else:
            terms.append("(oil OR crude OR petroleum OR refinery)")
    if country and not vessel_name:
        terms.append(f'"{country}"')
    return " ".join(anchors + terms).strip()


def fetch_gdelt_evidence(
    *,
    company: str = "",
    country: str = "",
    commodity: str = "",
    vessel_name: str = "",
    limit: int = 8,
) -> list[dict[str, Any]]:
    query = _build_gdelt_query(company, country, commodity, vessel_name)
    if not query:
        return []

    try:
        payload = _fetch_json(
            GDELT_DOC_URL,
            {
                "query": query,
                "mode": "artlist",
                "format": "json",
                "maxrecords": limit,
                "sort": "DateDesc",
            },
        )
    except (HTTPError, URLError, TimeoutError, ValueError):
        return []

    articles = payload.get("articles") if isinstance(payload, dict) else None
    if not isinstance(articles, list):
        return []

    evidence = []
    for index, article in enumerate(articles):
        title = _clean_text(article.get("title")) or "Untitled article"
        evidence.append(
            {
                "id": f"gdelt-{index}-{hash(_clean_text(article.get('url'))) & 0xfffffff}",
                "title": title,
                "url": _clean_text(article.get("url")),
                "source_label": "GDELT DOC 2.0",
                "source_domain": _clean_text(article.get("domain")) or None,
                "seen_at": _clean_text(article.get("seendate")) or None,
                "evidence_type": classify_evidence_type(title),
                "confidence": 0.62 if vessel_name or company else 0.5,
                "summary": _clean_text(article.get("title")) or None,
                "matched_terms": [term for term in [company, country, commodity, vessel_name] if _clean_text(term)],
            }
        )
    return evidence


def fetch_wikidata_vessel_identity(*, imo: str = "", mmsi: str = "") -> Optional[dict[str, Any]]:
    identifier = re.sub(r"[^0-9]", "", imo or mmsi or "")
    if not identifier:
        return None

    property_id = "P458" if imo else "P587"
    sparql = f"""
    SELECT ?item ?itemLabel ?ownerLabel ?operatorLabel ?flagLabel ?registryPortLabel WHERE {{
      ?item wdt:{property_id} "{identifier}" .
      OPTIONAL {{ ?item wdt:P127 ?owner . }}
      OPTIONAL {{ ?item wdt:P137 ?operator . }}
      OPTIONAL {{ ?item wdt:P17 ?flag . }}
      OPTIONAL {{ ?item wdt:P532 ?registryPort . }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    LIMIT 1
    """

    try:
        payload = _fetch_json(WIKIDATA_SPARQL_URL, {"query": sparql, "format": "json"})
        bindings = payload.get("results", {}).get("bindings", [])
    except (HTTPError, URLError, TimeoutError, ValueError):
        return None

    if not bindings:
        return None

    row = bindings[0]
    return {
        "owner": row.get("ownerLabel", {}).get("value"),
        "operator": row.get("operatorLabel", {}).get("value"),
        "flag": row.get("flagLabel", {}).get("value"),
        "registry_port": row.get("registryPortLabel", {}).get("value"),
        "matched_by": "imo" if imo else "mmsi",
        "confidence": 0.66 if imo else 0.52,
        "source_label": "Wikidata",
        "source_url": "https://query.wikidata.org/",
    }


def build_maritime_relationships(
    *,
    identity: Optional[dict[str, Any]],
    vessel_name: str = "",
    imo: str = "",
    mmsi: str = "",
) -> list[dict[str, Any]]:
    if not identity:
        return []

    source_entity_ref = _clean_text(imo) or _clean_text(mmsi) or _clean_text(vessel_name) or "unknown-vessel"
    relationships: list[dict[str, Any]] = []
    for relationship_type in ("owner", "operator"):
        target_name = _clean_text((identity or {}).get(relationship_type))
        if not target_name:
            continue
        relationships.append(
            {
                "id": f"vessel:{source_entity_ref}:{relationship_type}:{target_name.lower()}",
                "source_entity_kind": "vessel",
                "source_entity_ref": source_entity_ref,
                "target_entity_kind": "entity",
                "target_entity_ref": None,
                "target_name": target_name,
                "relationship_type": relationship_type,
                "relationship_label": None,
                "ownership_pct": None,
                "effective_date": None,
                "source_name": identity.get("source_label"),
                "source_url": identity.get("source_url"),
                "source_type": "open_knowledge_graph",
                "confidence_score": identity.get("confidence"),
                "raw_payload": {
                    "matched_by": identity.get("matched_by"),
                    "flag": identity.get("flag"),
                    "registry_port": identity.get("registry_port"),
                },
                "extracted_from": f"wikidata.{relationship_type}",
                "verified_at": None,
                "last_seen_at": _now_iso(),
            }
        )
    return relationships


def build_company_links(company: str, owner: str = "", operator: str = "") -> list[dict[str, Any]]:
    candidates = []
    for label in [company, owner, operator]:
        clean = _clean_text(label)
        if clean and clean.lower() not in {item.lower() for item in candidates}:
            candidates.append(clean)

    links = []
    for candidate in candidates[:3]:
        encoded = quote_plus(candidate)
        links.append(
            {
                "label": f"OpenCorporates: {candidate}",
                "url": f"https://opencorporates.com/companies?q={encoded}",
                "source_label": "OpenCorporates",
                "description": "Open company-registry search",
                "company_name": candidate,
                "confidence": 0.5,
            }
        )
    return links


def build_counterparty_proxies(
    *,
    commodity: str = "",
    matched_port: Optional[dict[str, Any]] = None,
    nearest_ports: list[dict[str, Any]] | None = None,
    evidence: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    proxies: list[dict[str, Any]] = []
    commodity_label = _clean_text(commodity) or "oil and gas"

    if matched_port:
        proxies.append(
            {
                "id": "destination-port",
                "label": f"Destination port proxy: {matched_port['name']}",
                "description": (
                    f"Open/free MVP can treat {matched_port['name']} ({matched_port['country_iso2']}) as the likely discharge jurisdiction "
                    f"or routing anchor, but not as a confirmed buyer or seller."
                ),
                "proxy_type": "destination_port_proxy",
                "confidence": float(matched_port.get("confidence") or 0.0),
                "source_label": matched_port["source_label"],
                "url": matched_port.get("source_url"),
            }
        )

    if nearest_ports:
        first_port = nearest_ports[0]
        proxies.append(
            {
                "id": "nearest-port",
                "label": f"Nearest export route proxy: {first_port['name']}",
                "description": (
                    f"The nearest open port context for {commodity_label} is {first_port['name']}. "
                    "This helps route screening, but it is still not bill-of-lading proof."
                ),
                "proxy_type": "nearest_port_proxy",
                "confidence": float(first_port.get("confidence") or 0.0),
                "source_label": first_port["source_label"],
                "url": first_port.get("source_url"),
            }
        )

    for article in evidence or []:
        if article["evidence_type"] == "counterparty_signal":
            proxies.append(
                {
                    "id": article["id"],
                    "label": "News-based counterparty signal",
                    "description": article["title"],
                    "proxy_type": "news_counterparty_signal",
                    "confidence": float(article.get("confidence") or 0.0),
                    "source_label": article["source_label"],
                    "url": article.get("url"),
                }
            )
            if len(proxies) >= 4:
                break

    return proxies


def _parse_ais_message(raw_message: dict[str, Any]) -> tuple[Optional[str], dict[str, Any]]:
    """Legacy helper — prefer vessel_ais.merge_ais_stream_message for full payloads."""
    try:
        from backend.services.vessel_ais import merge_ais_stream_message, new_vessel_accumulator
    except ImportError:
        from services.vessel_ais import merge_ais_stream_message, new_vessel_accumulator

    metadata = raw_message.get("MetaData") or raw_message.get("Metadata") or {}
    body_holder = raw_message.get("Message") or {}
    body: dict[str, Any] = {}
    if isinstance(body_holder, dict):
        message_type = _clean_text(raw_message.get("MessageType"))
        body = body_holder.get(message_type) or next(iter(body_holder.values()), {})
        if not isinstance(body, dict):
            body = {}

    mmsi = str(metadata.get("MMSI") or body.get("UserID") or body.get("MMSI") or "").strip()
    if not mmsi:
        return None, {}

    accumulator = new_vessel_accumulator(mmsi)
    merge_ais_stream_message(accumulator, raw_message)
    return mmsi, accumulator


async def _collect_ais_snapshot(
    *,
    timeout_seconds: float = AIS_DEFAULT_CAPTURE_WINDOW_SECONDS,
    max_vessels: int = AIS_DEFAULT_MAX_VESSELS,
    vessel_scope: str = "oil_tankers",
    viewport_bbox: Optional[tuple[float, float, float, float]] = None,
) -> dict[str, Any]:
    normalized_scope = _normalize_vessel_scope(vessel_scope)
    normalized_window = max(
        AIS_MIN_CAPTURE_WINDOW_SECONDS,
        min(int(timeout_seconds), AIS_MAX_CAPTURE_WINDOW_SECONDS),
    )
    normalized_max_vessels = max(1, min(int(max_vessels), AIS_MAX_VESSELS))
    plan = _build_ais_subscription_plan(viewport_bbox, worker_ingest=viewport_bbox is None)
    api_key = os.getenv("AISSTREAM_API_KEY", "").strip()
    if not api_key:
        return _build_empty_ais_response(
            source="AISStream (not configured)",
            limitations=[
                "AISStream requires AISSTREAM_API_KEY on the backend. Without it, the maritime map layer stays empty while dossier enrichment still works.",
            ],
            vessel_scope=normalized_scope,
            capture_window_seconds=normalized_window,
            max_vessels=normalized_max_vessels,
            plan=plan,
        )

    try:
        from backend.services.vessel_ais import merge_ais_stream_message, new_vessel_accumulator
    except ImportError:
        from services.vessel_ais import merge_ais_stream_message, new_vessel_accumulator

    try:
        import websockets  # type: ignore
    except Exception:
        return _build_empty_ais_response(
            source="AISStream (websocket client unavailable)",
            limitations=[
                "AISSTREAM_API_KEY is set, but the Python websockets package is unavailable in this runtime.",
            ],
            vessel_scope=normalized_scope,
            capture_window_seconds=normalized_window,
            max_vessels=normalized_max_vessels,
            plan=plan,
        )

    vessels: dict[str, dict[str, Any]] = {}
    subscription = {
        "APIKey": api_key,
        "BoundingBoxes": plan["boxes"],
        "FilterMessageTypes": [
            "PositionReport",
            "StandardClassBPositionReport",
            "ExtendedClassBPositionReport",
            "ShipStaticData",
            "StaticDataReport",
        ],
    }

    try:
        async with websockets.connect(AISSTREAM_URL, ping_interval=None, close_timeout=1) as websocket:
            await websocket.send(json.dumps(subscription))
            started = time.monotonic()
            raw_target_count = min(
                max(normalized_max_vessels * (4 if normalized_scope == "oil_tankers" else 2), 80),
                max(AIS_MAX_VESSELS * 2, 12000),
            )
            while time.monotonic() - started < normalized_window:
                remaining = normalized_window - (time.monotonic() - started)
                if remaining <= 0:
                    break
                try:
                    message_json = await asyncio.wait_for(websocket.recv(), timeout=min(1.0, remaining))
                except asyncio.TimeoutError:
                    continue

                raw_message = json.loads(message_json)
                metadata = raw_message.get("MetaData") or raw_message.get("Metadata") or {}
                body_holder = raw_message.get("Message") or {}
                body: dict[str, Any] = {}
                if isinstance(body_holder, dict):
                    message_type = _clean_text(raw_message.get("MessageType"))
                    body = body_holder.get(message_type) or next(iter(body_holder.values()), {})
                    if not isinstance(body, dict):
                        body = {}
                mmsi = str(
                    (metadata.get("MMSI") if isinstance(metadata, dict) else None)
                    or body.get("UserID")
                    or body.get("MMSI")
                    or ""
                ).strip()
                if not mmsi:
                    continue
                current = vessels.get(mmsi)
                if current is None:
                    current = new_vessel_accumulator(mmsi)
                    vessels[mmsi] = current
                merge_ais_stream_message(current, raw_message)
                if len(vessels) >= raw_target_count:
                    break
    except Exception as exc:
        return _build_empty_ais_response(
            source="AISStream",
            limitations=[f"AIS watch failed: {exc}"],
            vessel_scope=normalized_scope,
            capture_window_seconds=normalized_window,
            max_vessels=normalized_max_vessels,
            plan=plan,
        )

    try:
        from backend.services.vessel_ais import finalize_vessel_record
    except ImportError:
        from services.vessel_ais import finalize_vessel_record

    results = []
    for accumulator in vessels.values():
        record = finalize_vessel_record(
            accumulator,
            classify_ship_type=classify_ais_ship_type,
            match_destination_to_port=match_destination_to_port,
            find_nearest_ports=find_nearest_ports,
        )
        if record is None:
            continue
        if not _ship_matches_scope(record.get("ship_type_label") or "", normalized_scope):
            continue
        results.append(record)

    if normalized_scope == "oil_tankers":
        results.sort(
            key=lambda item: (
                -petroleum_vessel_priority(item.get("ship_type_code"), item.get("ship_type_label")),
                str(item.get("observed_at") or ""),
            ),
            reverse=True,
        )
    else:
        results.sort(key=lambda item: str(item.get("observed_at") or ""), reverse=True)
    source_label = {
        "viewport_bbox": "AISStream viewport watch",
        "sampled_viewport_regions": "AISStream sampled viewport watch",
        "default_regions": "AISStream regional watch",
        "all_regions": "AISStream multi-region watch",
        "global": "AISStream global watch",
        "rotating": "AISStream rotating regional watch",
    }.get(plan.get("geography_mode"), "AISStream watch")

    limitations = []
    if plan.get("geography_note"):
        limitations.append(str(plan["geography_note"]))
    if normalized_scope == "oil_tankers":
        limitations.append(
            "Oil-focused scope ranks tankers and petroleum-relevant vessels first; widen max_vessels or switch to all_vessels for neutral ordering."
        )
    else:
        limitations.append(
            "All-vessels mode is still capped by the requested viewport, capture window, and vessel limit for performance."
        )
    limitations.append(
        "AIS ownership/operator enrichment depends on whether the MMSI or IMO can be matched in open sources such as Wikidata."
    )
    return {
        "vessels": results[:normalized_max_vessels],
        "source": source_label,
        "data_as_of": _now_iso(),
        "live_positions_enabled": True,
        "limitations": limitations,
        "scope": normalized_scope,
        "capture_window_seconds": normalized_window,
        "max_vessels": normalized_max_vessels,
        "geography_mode": plan.get("geography_mode"),
        "geography_note": plan.get("geography_note"),
        "requested_bbox": plan.get("requested_bbox"),
        "effective_bbox_count": len(plan.get("boxes") or []),
        "region_labels": plan.get("region_labels") or [],
    }


def _maritime_gulf_demo_env() -> bool:
    return os.getenv("MARITIME_GULF_DEMO_SEED", "").strip().lower() in ("1", "true", "yes")


def _maritime_coastal_demo_env() -> bool:
    """Unified Gulf + Africa sparse-region demo seed (server-side)."""
    return os.getenv("MARITIME_COASTAL_DEMO_SEED", "").strip().lower() in ("1", "true", "yes")


def _coastal_demo_reference_ingest_ok(
    all_rows: list[dict[str, Any]],
    *,
    worker_ok: bool,
    north_reference_count: int,
) -> bool:
    """True when snapshots look healthy enough to treat empty coastal boxes as upstream sparsity, not total outage."""
    if not worker_ok:
        return False
    if north_reference_count >= 25:
        return True
    if len(all_rows) >= 150:
        return True
    return False


def _maritime_coastal_demo_per_region_count() -> int:
    try:
        raw = int(os.getenv("MARITIME_COASTAL_DEMO_PER_REGION", "72"))
    except (TypeError, ValueError):
        raw = 72
    return max(12, min(raw, 500))


def maritime_coastal_demo_merge_decision(
    *,
    live_counts: dict[str, int],
    reference_ingest_ok: bool,
    coverage_gap_persian_gulf: bool,
    include_coastal_demo: bool,
    include_gulf_demo: bool,
    env_coastal: bool,
    env_gulf_only: bool,
    sparse_threshold: int,
) -> dict[str, Any]:
    """
    Pure helper for tests: decide which coastal demo regions merge into the feed.

    live_counts keys: persian_gulf_hormuz plus each MARITIME_COASTAL_DEMO_AFRICA_SPECS id.
    """
    ref_ok = reference_ingest_ok

    merge_gulf = False
    merge_africa = False

    if include_coastal_demo:
        merge_gulf = True
        merge_africa = True
    elif include_gulf_demo:
        merge_gulf = True
    elif env_coastal:
        merge_gulf = bool(ref_ok and live_counts.get("persian_gulf_hormuz", 0) < sparse_threshold)
        merge_africa = bool(ref_ok)
    elif env_gulf_only:
        merge_gulf = bool(coverage_gap_persian_gulf)

    africa_region_ids: list[str] = []
    if merge_africa:
        for spec in MARITIME_COASTAL_DEMO_AFRICA_SPECS:
            rid = str(spec["id"])
            if include_coastal_demo or (ref_ok and live_counts.get(rid, 0) < sparse_threshold):
                africa_region_ids.append(rid)

    return {
        "merge_gulf": merge_gulf,
        "merge_africa_region_ids": africa_region_ids,
        "reference_ingest_ok": ref_ok,
    }


def _load_persian_gulf_demo_seed_rows() -> list[dict[str, Any]]:
    """Load Hormuz-area demo rows from MARITIME_GULF_SEED_FILE or built-in synthetic generator."""
    seed_path = os.getenv("MARITIME_GULF_SEED_FILE", "").strip()
    try:
        if seed_path and os.path.isfile(seed_path):
            return load_maritime_gulf_demo_rows_from_file(seed_path)
        return build_synthetic_persian_gulf_demo_rows(_maritime_gulf_demo_target_count())
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        return []


def _load_africa_coastal_demo_seed_rows() -> list[dict[str, Any]]:
    path = os.getenv("MARITIME_AFRICA_SEED_FILE", "").strip()
    if not path or not os.path.isfile(path):
        return []
    try:
        return load_maritime_africa_demo_rows_from_file(path)
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        return []


def _should_merge_persian_gulf_demo_rows(*, include_gulf_demo: bool, demo_env: bool, coverage_gap: bool) -> bool:
    """Explicit API opt-in always wins; otherwise env-gated merge only when AISStream gap heuristic fires."""
    if include_gulf_demo:
        return True
    return bool(demo_env and coverage_gap)


def get_maritime_vessel_feed(
    *,
    max_vessels: int = AIS_DEFAULT_MAX_VESSELS,
    capture_window_seconds: int = AIS_DEFAULT_CAPTURE_WINDOW_SECONDS,
    vessel_scope: str = "oil_tankers",
    bbox: Optional[tuple[float, float, float, float]] = None,
    offset: int = 0,
    include_gulf_demo: bool = False,
    include_coastal_demo: bool = False,
) -> dict[str, Any]:
    normalized_scope = _normalize_vessel_scope(vessel_scope)
    normalized_max_vessels = max(1, min(int(max_vessels), AIS_MAX_VESSELS))
    normalized_window = max(
        AIS_MIN_CAPTURE_WINDOW_SECONDS,
        min(int(capture_window_seconds), AIS_MAX_CAPTURE_WINDOW_SECONDS),
    )
    normalized_offset = max(0, int(offset))
    normalized_bbox = _normalize_requested_bbox(bbox)
    plan = _build_ais_subscription_plan(normalized_bbox)

    try:
        conn = _db_connect()
    except Exception as exc:
        return _build_empty_ais_response(
            source="AISStream persisted snapshot (database unavailable)",
            limitations=[
                f"Maritime snapshots could not be read from Postgres: {exc}",
                "The backend does not open live AIS websockets in the request path; start maritime-worker to populate snapshots.",
            ],
            vessel_scope=normalized_scope,
            capture_window_seconds=normalized_window,
            max_vessels=normalized_max_vessels,
            plan=plan,
            offset=normalized_offset,
        )

    try:
        cache_age = time.time() - float(_maritime_memory_cache.get("loaded_at") or 0.0)
        if cache_age > MARITIME_MEMORY_CACHE_TTL_SECONDS or not _maritime_memory_cache.get("rows"):
            _refresh_maritime_memory_cache(conn)
            cache_age = time.time() - float(_maritime_memory_cache.get("loaded_at") or 0.0)

        all_rows = list(_maritime_memory_cache.get("rows") or [])
        status = _maritime_memory_cache.get("status")

        worker_ok = (status or {}).get("status") == "ok"
        gulf_c = count_maritime_rows_in_bbox(all_rows, PERSIAN_GULF_CORE_BBOX)
        north_c = count_maritime_rows_in_bbox(all_rows, _north_sea_reference_bbox())
        coverage_gap = bool(gulf_c == 0 and north_c >= 25 and worker_ok)

        env_gulf = _maritime_gulf_demo_env()
        env_coastal = _maritime_coastal_demo_env()
        ref_ok = _coastal_demo_reference_ingest_ok(all_rows, worker_ok=worker_ok, north_reference_count=north_c)

        live_counts: dict[str, int] = {"persian_gulf_hormuz": gulf_c}
        for spec in MARITIME_COASTAL_DEMO_AFRICA_SPECS:
            live_counts[str(spec["id"])] = count_maritime_rows_in_bbox(all_rows, spec["bbox"])

        decision = maritime_coastal_demo_merge_decision(
            live_counts=live_counts,
            reference_ingest_ok=ref_ok,
            coverage_gap_persian_gulf=coverage_gap,
            include_coastal_demo=bool(include_coastal_demo),
            include_gulf_demo=bool(include_gulf_demo),
            env_coastal=env_coastal,
            env_gulf_only=bool(env_gulf and not env_coastal),
            sparse_threshold=MARITIME_COASTAL_DEMO_SPARSE_THRESHOLD,
        )

        gulf_demo_rows: list[dict[str, Any]] = []
        africa_demo_rows: list[dict[str, Any]] = []
        coastal_demo_regions: list[str] = []
        coastal_demo_synthetic = False

        if decision["merge_gulf"]:
            gulf_demo_rows = _load_persian_gulf_demo_seed_rows()
        if gulf_demo_rows:
            coastal_demo_regions.append("Persian Gulf / Strait of Hormuz")
            coastal_demo_synthetic = coastal_demo_synthetic or any(
                "synthetic" in str(r.get("source_label") or "").lower() for r in gulf_demo_rows
            )

        per_region = _maritime_coastal_demo_per_region_count()
        africa_ids = set(decision.get("merge_africa_region_ids") or [])
        for spec in MARITIME_COASTAL_DEMO_AFRICA_SPECS:
            if str(spec["id"]) not in africa_ids:
                continue
            block = build_synthetic_maritime_demo_rows_for_bbox(
                spec["bbox"],
                per_region,
                id_prefix=str(spec["id_prefix"]),
                vessel_name_prefix=str(spec["vessel_name_prefix"]),
                source_label=str(spec["source_label"]),
                source_url=AISSTREAM_PERSIAN_GULF_ISSUE_URL,
                mmsi_start=int(spec["mmsi_start"]),
                prng_salt=int(spec.get("prng_salt") or 0),
            )
            africa_demo_rows.extend(block)
            coastal_demo_regions.append(str(spec["label"]))
            coastal_demo_synthetic = True

        africa_file_rows: list[dict[str, Any]] = []
        if include_coastal_demo or env_coastal:
            africa_file_rows = _load_africa_coastal_demo_seed_rows()
        demo_rows = list(gulf_demo_rows) + list(africa_demo_rows)
        if africa_file_rows:
            seen_mmsi = {_clean_text(r.get("mmsi")) for r in demo_rows if _clean_text(r.get("mmsi"))}
            file_added = 0
            for row in africa_file_rows:
                mmsi_key = _clean_text(row.get("mmsi"))
                if mmsi_key and mmsi_key in seen_mmsi:
                    continue
                demo_rows.append(row)
                file_added += 1
                if mmsi_key:
                    seen_mmsi.add(mmsi_key)
            if file_added:
                coastal_demo_regions.append("Africa coast (seed file)")

        augmented_rows = all_rows + demo_rows
        scoped_rows = filter_maritime_rows_by_bbox(augmented_rows, normalized_bbox)
        sorted_rows = _sort_maritime_rows(scoped_rows, normalized_scope)
        total_available = len(sorted_rows)
        page_rows = sorted_rows[normalized_offset : normalized_offset + normalized_max_vessels]
        response = _build_stored_feed_response(
            rows=page_rows,
            status=dict(status) if status else None,
            max_vessels=normalized_max_vessels,
            offset=normalized_offset,
            total_available=total_available,
            capture_window_seconds=normalized_window,
            vessel_scope=normalized_scope,
            bbox=normalized_bbox,
        )
        response["memory_cached"] = True
        response["memory_cache_age_seconds"] = round(cache_age, 2) if cache_age >= 0 else None
        response["snapshot_vessel_count"] = len(all_rows)
        response["aisstream_persian_gulf_coverage_gap"] = coverage_gap
        response["persian_gulf_demo_synthetic"] = bool(gulf_demo_rows)
        response["coastal_demo_regions"] = coastal_demo_regions
        response["coastal_demo_synthetic"] = bool(coastal_demo_synthetic)
        if gulf_demo_rows:
            if include_coastal_demo or include_gulf_demo:
                pg_mode = "api_opt_in"
            elif env_coastal and ref_ok and gulf_c < MARITIME_COASTAL_DEMO_SPARSE_THRESHOLD:
                pg_mode = "env_coastal_sparse"
            elif env_gulf and coverage_gap:
                pg_mode = "env_coverage_gap"
            else:
                pg_mode = None
        else:
            pg_mode = None
        response["persian_gulf_demo_mode"] = pg_mode
        response["maritime_aisstream_issue_url"] = AISSTREAM_PERSIAN_GULF_ISSUE_URL
        if demo_rows:
            if include_coastal_demo:
                demo_note = (
                    "Coastal sparse-feed demo: synthetic Gulf and Africa-adjacent positions merged because "
                    "include_coastal_demo=1 was requested; these are not live AIS for those boxes. Other rows may "
                    "still be real persisted AIS snapshot positions."
                )
            elif include_gulf_demo:
                demo_note = (
                    "Persian Gulf Hormuz demo: synthetic positions merged because include_gulf_demo was requested; "
                    "these are not live AIS positions for the Gulf. Other vessels in this response may still be "
                    "real persisted AIS snapshot positions."
                )
            elif env_coastal:
                demo_note = (
                    "Coastal sparse-feed demo: synthetic positions merged while MARITIME_COASTAL_DEMO_SEED is enabled "
                    "for low-coverage Hormuz and/or Africa-adjacent reference boxes; this does not represent restored "
                    "AISStream coverage."
                )
            else:
                demo_note = (
                    "Persian Gulf Hormuz demo: synthetic positions merged while MARITIME_GULF_DEMO_SEED is enabled; "
                    "this does not represent restored AISStream coverage."
                )
            lim = list(response.get("limitations") or [])
            if demo_note not in lim:
                lim.append(demo_note)
            response["limitations"] = lim
        return response
    except Exception as exc:
        conn.rollback()
        return _build_empty_ais_response(
            source="AISStream persisted snapshot (read error)",
            limitations=[
                f"Maritime snapshots could not be read from Postgres: {exc}",
                "The backend does not open live AIS websockets in the request path; start maritime-worker to populate snapshots.",
            ],
            vessel_scope=normalized_scope,
            capture_window_seconds=normalized_window,
            max_vessels=normalized_max_vessels,
            plan=plan,
            offset=normalized_offset,
        )
    finally:
        conn.close()


def collect_live_maritime_vessel_feed(
    *,
    max_vessels: int = AIS_MAX_VESSELS,
    capture_window_seconds: int = AIS_DEFAULT_CAPTURE_WINDOW_SECONDS,
    vessel_scope: str = "all_vessels",
    bbox: Optional[tuple[float, float, float, float]] = None,
) -> dict[str, Any]:
    normalized_scope = _normalize_vessel_scope(vessel_scope)
    normalized_max_vessels = max(1, min(int(max_vessels), AIS_MAX_VESSELS))
    normalized_window = max(
        AIS_MIN_CAPTURE_WINDOW_SECONDS,
        min(int(capture_window_seconds), AIS_MAX_CAPTURE_WINDOW_SECONDS),
    )
    normalized_bbox = _normalize_requested_bbox(bbox)
    return asyncio.run(
        _collect_ais_snapshot(
            timeout_seconds=normalized_window,
            max_vessels=normalized_max_vessels,
            vessel_scope=normalized_scope,
            viewport_bbox=normalized_bbox,
        )
    )


def merge_maritime_vessel_feeds(
    feeds: list[dict[str, Any]],
    *,
    max_vessels: int,
    vessel_scope: str = "all_vessels",
) -> dict[str, Any]:
    """Merge multiple AIS captures by MMSI, keeping the freshest position per vessel."""
    normalized_scope = _normalize_vessel_scope(vessel_scope)
    normalized_max_vessels = max(1, min(int(max_vessels), AIS_MAX_VESSELS))
    merged_by_mmsi: dict[str, dict[str, Any]] = {}
    for feed in feeds:
        if not isinstance(feed, dict):
            continue
        for vessel in feed.get("vessels") or []:
            if not isinstance(vessel, dict):
                continue
            mmsi = _clean_text(vessel.get("mmsi"))
            if not mmsi:
                continue
            existing = merged_by_mmsi.get(mmsi)
            if existing is None or str(vessel.get("observed_at") or "") >= str(
                existing.get("observed_at") or ""
            ):
                merged_by_mmsi[mmsi] = vessel

    vessels = list(merged_by_mmsi.values())
    vessels = _sort_maritime_rows(vessels, normalized_scope)[:normalized_max_vessels]
    base = next((feed for feed in reversed(feeds) if isinstance(feed, dict)), {})
    limitations = []
    for feed in feeds:
        if not isinstance(feed, dict):
            continue
        for item in feed.get("limitations") or []:
            if item and item not in limitations:
                limitations.append(str(item))
    return {
        **base,
        "vessels": vessels,
        "scope": normalized_scope,
        "max_vessels": normalized_max_vessels,
        "total_available": len(merged_by_mmsi),
        "returned_count": len(vessels),
        "limitations": limitations,
        "live_positions_enabled": any(bool(feed.get("live_positions_enabled")) for feed in feeds if isinstance(feed, dict)),
        "data_as_of": _now_iso(),
    }


def collect_worker_maritime_vessel_feed(
    *,
    max_vessels: int = AIS_MAX_VESSELS,
    capture_window_seconds: int = AIS_DEFAULT_CAPTURE_WINDOW_SECONDS,
    vessel_scope: str = "all_vessels",
) -> dict[str, Any]:
    """
    Worker ingest: multi-region watch plus a dedicated Persian Gulf / Hormuz capture so
    high-traffic chokepoints are not crowded out by the global vessel cap.
    """
    normalized_max_vessels = max(1, min(int(max_vessels), AIS_MAX_VESSELS))
    normalized_window = max(
        AIS_MIN_CAPTURE_WINDOW_SECONDS,
        min(int(capture_window_seconds), AIS_MAX_CAPTURE_WINDOW_SECONDS),
    )
    gulf_max = min(MARITIME_GULF_SUPPLEMENT_MAX_VESSELS, normalized_max_vessels)
    gulf_feed = collect_live_maritime_vessel_feed(
        max_vessels=gulf_max,
        capture_window_seconds=min(
            normalized_window,
            MARITIME_GULF_SUPPLEMENT_WINDOW_SECONDS,
        ),
        vessel_scope=vessel_scope,
        bbox=PERSIAN_GULF_CORE_BBOX,
    )
    main_feed = collect_live_maritime_vessel_feed(
        max_vessels=normalized_max_vessels,
        capture_window_seconds=normalized_window,
        vessel_scope=vessel_scope,
    )
    merged = merge_maritime_vessel_feeds(
        [gulf_feed, main_feed],
        max_vessels=normalized_max_vessels,
        vessel_scope=vessel_scope,
    )
    merged["geography_mode"] = main_feed.get("geography_mode")
    merged["geography_note"] = main_feed.get("geography_note")
    merged["region_labels"] = list(
        dict.fromkeys(
            (gulf_feed.get("region_labels") or [])
            + (main_feed.get("region_labels") or [])
            + ["Persian Gulf and Strait of Hormuz (supplemental)"]
        )
    )
    merged["effective_bbox_count"] = int(main_feed.get("effective_bbox_count") or 0) + 1
    merged["source"] = main_feed.get("source") or "AISStream multi-region watch"
    merged_limitations = list(merged.get("limitations") or [])
    supplement_note = (
        "Persian Gulf / Strait of Hormuz supplemental watch runs every worker cycle."
    )
    if supplement_note not in merged_limitations:
        merged_limitations.append(supplement_note)
    merged["limitations"] = merged_limitations
    gulf_count = count_maritime_rows_in_bbox(merged.get("vessels") or [], PERSIAN_GULF_CORE_BBOX)
    if gulf_count == 0:
        north_sea_count = count_maritime_rows_in_bbox(
            main_feed.get("vessels") or [],
            _north_sea_reference_bbox(),
        )
        if north_sea_count > 0:
            merged_limitations.append(
                "AISStream returned no vessels in the Persian Gulf / Strait of Hormuz box during this cycle. "
                "This is a known upstream coverage gap (see aisstream/aisstream#17); other regions may still update."
            )
            merged["limitations"] = merged_limitations
    merged["persian_gulf_vessel_count"] = gulf_count
    return merged


def load_maritime_seed_snapshot(path: str) -> dict[str, Any]:
    """Load vessels from a JSON file: either {\"vessels\": [...]} or a top-level array."""
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, list):
        vessels = payload
    elif isinstance(payload, dict):
        vessels = payload.get("vessels") or []
    else:
        vessels = []
    if not isinstance(vessels, list):
        vessels = []
    return {
        "vessels": vessels,
        "source": f"AIS seed ({os.path.basename(path)})",
        "data_as_of": _now_iso(),
        "live_positions_enabled": False,
        "limitations": ["Seeded from MARITIME_AIS_SEED_FILE; positions refresh when the worker ingests live AIS."],
        "scope": "all_vessels",
        "capture_window_seconds": 0,
        "max_vessels": len(vessels),
        "geography_mode": "seed_file",
        "geography_note": f"Loaded static AIS snapshot from {path}.",
        "region_labels": [],
        "effective_bbox_count": 0,
    }



def _maritime_gulf_demo_target_count() -> int:
    try:
        raw = int(os.getenv("MARITIME_GULF_DEMO_COUNT", "200"))
    except (TypeError, ValueError):
        raw = 200
    return max(20, min(raw, 2000))


def _snapshot_row_from_demo_vessel(vessel: dict[str, Any]) -> dict[str, Any]:
    """Build an in-memory cache row compatible with `_build_stored_feed_response`."""
    observed = _parse_datetime(vessel.get("observed_at")) or datetime.now(timezone.utc)
    last_seen = _parse_datetime(vessel.get("last_seen_at")) or observed
    payload = dict(vessel)
    return {
        "mmsi": _clean_text(vessel.get("mmsi")),
        "vessel_name": vessel.get("vessel_name"),
        "lat": float(vessel["lat"]),
        "lng": float(vessel["lng"]),
        "observed_at": observed,
        "source_label": vessel.get("source_label"),
        "source_url": vessel.get("source_url"),
        "ship_type_code": vessel.get("ship_type_code"),
        "ship_type_label": vessel.get("ship_type_label"),
        "payload": payload,
        "last_seen_at": last_seen,
    }


def build_synthetic_maritime_demo_rows_for_bbox(
    bbox: tuple[float, float, float, float],
    count: int,
    *,
    id_prefix: str,
    vessel_name_prefix: str,
    source_label: str,
    source_url: str,
    mmsi_start: int,
    prng_salt: int = 0,
) -> list[dict[str, Any]]:
    """Deterministic synthetic AIS-like rows inside ``bbox`` (demo / UX only)."""
    south, west, north, east = bbox
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    labels_specs = [
        ("Tanker", 82),
        ("Tanker", 81),
        ("Cargo", 71),
        ("Cargo", 72),
        ("Passenger", 60),
        ("Unknown", 0),
    ]
    rows: list[dict[str, Any]] = []
    span_lat = north - south
    span_lng = east - west
    for i in range(count):
        a = (i * 1103515245 + 12345 + prng_salt * 9973) & 0x7FFFFFFF
        b = (i * 7919 + 104729 + prng_salt * 13) & 0x7FFFFFFF
        u = (a % 1_000_000) / 1_000_000.0
        v = (b % 1_000_000) / 1_000_000.0
        lat = south + u * span_lat
        lng = west + v * span_lng
        _label, code = labels_specs[i % len(labels_specs)]
        mmsi = str(mmsi_start + i + 1)
        st_label = "Unknown" if code == 0 else _label
        vessel = {
            "id": f"{id_prefix}:{i + 1:04d}",
            "mmsi": mmsi,
            "vessel_name": f"{vessel_name_prefix} {i + 1:03d}",
            "lat": lat,
            "lng": lng,
            "observed_at": now_iso,
            "last_seen_at": now_iso,
            "source_label": source_label,
            "source_url": source_url,
            "speed_knots": 8.0 + (i % 9) * 0.5,
            "ship_type_code": code,
            "ship_type_label": st_label,
        }
        rows.append(_snapshot_row_from_demo_vessel(vessel))
    return rows


def build_synthetic_persian_gulf_demo_rows(count: int) -> list[dict[str, Any]]:
    """Deterministic synthetic AIS-like rows inside PERSIAN_GULF_CORE_BBOX (demo / UX only)."""
    return build_synthetic_maritime_demo_rows_for_bbox(
        PERSIAN_GULF_CORE_BBOX,
        count,
        id_prefix="demo:gulf",
        vessel_name_prefix="Hormuz Demo",
        source_label="Hormuz demo (synthetic)",
        source_url=AISSTREAM_PERSIAN_GULF_ISSUE_URL,
        mmsi_start=999_000_000,
        prng_salt=0,
    )


def load_maritime_gulf_demo_rows_from_file(
    path: str,
    *,
    geojson_id_prefix: str = "demo:gulf",
    seed_name_prefix: str = "Hormuz Seed",
    default_source_label: str = "Hormuz demo (seed file)",
    default_source_url: str = AISSTREAM_PERSIAN_GULF_ISSUE_URL,
) -> list[dict[str, Any]]:
    """
    Load demo vessels from JSON / GeoJSON.
    Accepts: {\"vessels\": [...]}, a top-level array, or a GeoJSON FeatureCollection of Points.
    Each vessel should include lat/lng (or GeoJSON coordinates), mmsi, and optional ship fields.
    """
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    rows: list[dict[str, Any]] = []
    if isinstance(data, dict) and str(data.get("type")).lower() == "featurecollection":
        for idx, feat in enumerate(data.get("features") or []):
            if not isinstance(feat, dict):
                continue
            geom = feat.get("geometry")
            props = feat.get("properties") if isinstance(feat.get("properties"), dict) else {}
            if not isinstance(geom, dict):
                continue
            coords = geom.get("coordinates")
            if str(geom.get("type")).lower() != "point" or not isinstance(coords, list) or len(coords) < 2:
                continue
            lng_f = float(coords[0])
            lat_f = float(coords[1])
            mmsi = _clean_text(props.get("mmsi")) or f"998{idx + 1:06d}"
            code_raw = props.get("ship_type_code", props.get("ship_type"))
            code_i, st_lbl = classify_ais_ship_type(code_raw)
            vessel = {
                "id": props.get("id") or f"{geojson_id_prefix}:{idx + 1:04d}",
                "mmsi": mmsi,
                "vessel_name": props.get("vessel_name") or props.get("name") or f"{seed_name_prefix} {idx + 1}",
                "lat": lat_f,
                "lng": lng_f,
                "observed_at": props.get("observed_at") or _now_iso(),
                "last_seen_at": props.get("last_seen_at") or props.get("observed_at") or _now_iso(),
                "source_label": props.get("source_label") or default_source_label,
                "source_url": props.get("source_url") or default_source_url,
                "ship_type_code": props.get("ship_type_code", code_i),
                "ship_type_label": props.get("ship_type_label") or st_lbl,
            }
            rows.append(_snapshot_row_from_demo_vessel(vessel))
        return rows
    vessels_list: list[Any] = []
    if isinstance(data, dict):
        vessels_list = data.get("vessels") or []
    elif isinstance(data, list):
        vessels_list = data
    for item in vessels_list:
        if isinstance(item, dict):
            rows.append(_snapshot_row_from_demo_vessel(item))
    return rows


def load_maritime_africa_demo_rows_from_file(path: str) -> list[dict[str, Any]]:
    """Optional JSON/GeoJSON seed for Africa-adjacent coastal demo positions (``MARITIME_AFRICA_SEED_FILE``)."""
    return load_maritime_gulf_demo_rows_from_file(
        path,
        geojson_id_prefix="demo:africa",
        seed_name_prefix="Africa Seed",
        default_source_label="Africa coast demo (seed file)",
        default_source_url=AISSTREAM_PERSIAN_GULF_ISSUE_URL,
    )


def get_maritime_stats(
    bbox: Optional[tuple[float, float, float, float]] = None,
) -> dict[str, Any]:
    from psycopg2.extras import RealDictCursor

    normalized_bbox = _normalize_requested_bbox(bbox)
    try:
        conn = _db_connect()
    except Exception as exc:
        return {
            "stored_vessel_count": 0,
            "snapshot_vessel_count": 0,
            "persian_gulf_vessel_count": 0,
            "north_sea_vessel_count": 0,
            "aisstream_persian_gulf_coverage_gap": False,
            "bbox_vessel_count": 0,
            "requested_bbox": list(normalized_bbox) if normalized_bbox else None,
            "memory_cache_loaded": False,
            "memory_cache_age_seconds": None,
            "aisstream_configured": bool(os.getenv("AISSTREAM_API_KEY", "").strip()),
            "worker": {"status": "database_unavailable", "last_error": str(exc)},
            "limits": {
                "ais_max_vessels": AIS_MAX_VESSELS,
                "memory_cache_max_vessels": MARITIME_MEMORY_CACHE_MAX_VESSELS,
                "snapshot_ttl_seconds": MARITIME_SNAPSHOT_TTL_SECONDS,
                "snapshot_retention_seconds": MARITIME_SNAPSHOT_RETENTION_SECONDS,
                "worker_watch_mode": _resolve_worker_watch_mode(),
                "persian_gulf_bbox": list(PERSIAN_GULF_CORE_BBOX),
            },
        }

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS count
                FROM maritime_vessel_snapshots
                WHERE last_seen_at >= NOW() - (%s * INTERVAL '1 second')
                """,
                (MARITIME_SNAPSHOT_RETENTION_SECONDS,),
            )
            stored_count = int((cur.fetchone() or {}).get("count") or 0)
            gulf_south, gulf_west, gulf_north, gulf_east = PERSIAN_GULF_CORE_BBOX
            cur.execute(
                """
                SELECT COUNT(*) AS count
                FROM maritime_vessel_snapshots
                WHERE last_seen_at >= NOW() - (%s * INTERVAL '1 second')
                  AND lat BETWEEN %s AND %s
                  AND lng BETWEEN %s AND %s
                """,
                (
                    MARITIME_SNAPSHOT_RETENTION_SECONDS,
                    gulf_south,
                    gulf_north,
                    gulf_west,
                    gulf_east,
                ),
            )
            persian_gulf_count = int((cur.fetchone() or {}).get("count") or 0)
            north_south, north_west, north_north, north_east = _north_sea_reference_bbox()
            cur.execute(
                """
                SELECT COUNT(*) AS count
                FROM maritime_vessel_snapshots
                WHERE last_seen_at >= NOW() - (%s * INTERVAL '1 second')
                  AND lat BETWEEN %s AND %s
                  AND lng BETWEEN %s AND %s
                """,
                (
                    MARITIME_SNAPSHOT_RETENTION_SECONDS,
                    north_south,
                    north_north,
                    north_west,
                    north_east,
                ),
            )
            north_sea_count = int((cur.fetchone() or {}).get("count") or 0)
            bbox_count = 0
            if normalized_bbox is not None:
                south, west, north, east = normalized_bbox
                cur.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM maritime_vessel_snapshots
                    WHERE last_seen_at >= NOW() - (%s * INTERVAL '1 second')
                      AND lat BETWEEN %s AND %s
                      AND lng BETWEEN %s AND %s
                    """,
                    (
                        MARITIME_SNAPSHOT_RETENTION_SECONDS,
                        south,
                        north,
                        west,
                        east,
                    ),
                )
                bbox_count = int((cur.fetchone() or {}).get("count") or 0)
            cur.execute(
                """
                SELECT status, source, last_attempt_at, last_success_at, last_error, snapshot_count, metadata
                FROM maritime_ingest_status
                WHERE id = %s
                """,
                (MARITIME_WORKER_STATUS_ID,),
            )
            status_row = cur.fetchone()

        cache_age = time.time() - float(_maritime_memory_cache.get("loaded_at") or 0.0)
        cached_rows = _maritime_memory_cache.get("rows") or []
        if cache_age > MARITIME_MEMORY_CACHE_TTL_SECONDS or not cached_rows:
            _refresh_maritime_memory_cache(conn)
            cache_age = time.time() - float(_maritime_memory_cache.get("loaded_at") or 0.0)
            cached_rows = _maritime_memory_cache.get("rows") or []

        status = dict(status_row) if status_row else {}
        metadata = status.get("metadata") if isinstance(status.get("metadata"), dict) else {}
        last_success = _parse_datetime(status.get("last_success_at"))
        snapshot_age_seconds = _seconds_since(last_success)
        return {
            "stored_vessel_count": stored_count,
            "snapshot_vessel_count": len(cached_rows),
            "persian_gulf_vessel_count": persian_gulf_count,
            "north_sea_vessel_count": north_sea_count,
            "aisstream_persian_gulf_coverage_gap": bool(
                persian_gulf_count == 0
                and north_sea_count >= 25
                and (status.get("status") or "") == "ok"
            ),
            "bbox_vessel_count": bbox_count,
            "requested_bbox": list(normalized_bbox) if normalized_bbox else None,
            "memory_cache_loaded": bool(cached_rows),
            "memory_cache_age_seconds": round(cache_age, 2) if cache_age >= 0 else None,
            "aisstream_configured": bool(os.getenv("AISSTREAM_API_KEY", "").strip()),
            "stale": snapshot_age_seconds is None or snapshot_age_seconds > MARITIME_SNAPSHOT_TTL_SECONDS,
            "snapshot_age_seconds": snapshot_age_seconds,
            "worker": {
                "status": status.get("status") or "unknown",
                "source": status.get("source") or "AISStream",
                "last_attempt_at": _iso_datetime(status.get("last_attempt_at")),
                "last_success_at": _iso_datetime(status.get("last_success_at")),
                "last_error": status.get("last_error"),
                "last_cycle_upserted": status.get("snapshot_count") or 0,
                "geography_mode": metadata.get("geography_mode"),
                "region_labels": metadata.get("region_labels") or [],
                "effective_bbox_count": metadata.get("effective_bbox_count"),
            },
            "limits": {
                "ais_max_vessels": AIS_MAX_VESSELS,
                "memory_cache_max_vessels": MARITIME_MEMORY_CACHE_MAX_VESSELS,
                "snapshot_ttl_seconds": MARITIME_SNAPSHOT_TTL_SECONDS,
                "snapshot_retention_seconds": MARITIME_SNAPSHOT_RETENTION_SECONDS,
                "worker_watch_mode": _resolve_worker_watch_mode(),
                "worker_region_count": len(_regions_for_worker_watch_mode(_resolve_worker_watch_mode())),
                "persian_gulf_bbox": list(PERSIAN_GULF_CORE_BBOX),
                "always_on_region_ids": list(MARITIME_ALWAYS_ON_REGION_IDS),
            },
        }
    finally:
        conn.close()


def persist_maritime_vessel_feed(conn, feed: dict[str, Any]) -> int:
    from psycopg2.extras import Json

    ensure_maritime_tables(conn)
    vessels = feed.get("vessels") if isinstance(feed, dict) else []
    if not isinstance(vessels, list):
        vessels = []

    upserted = 0
    with conn.cursor() as cur:
        for vessel in vessels:
            if not isinstance(vessel, dict):
                continue
            mmsi = _clean_text(vessel.get("mmsi"))
            lat = vessel.get("lat")
            lng = vessel.get("lng")
            if not mmsi or lat is None or lng is None:
                continue
            observed_at = _parse_datetime(vessel.get("observed_at")) or datetime.now(timezone.utc)
            cur.execute(
                """
                INSERT INTO maritime_vessel_snapshots (
                    mmsi,
                    vessel_name,
                    lat,
                    lng,
                    observed_at,
                    source_label,
                    source_url,
                    ship_type_code,
                    ship_type_label,
                    payload,
                    last_seen_at,
                    updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s::timestamptz, NOW()), NOW())
                ON CONFLICT (mmsi) DO UPDATE SET
                    vessel_name = EXCLUDED.vessel_name,
                    lat = EXCLUDED.lat,
                    lng = EXCLUDED.lng,
                    observed_at = EXCLUDED.observed_at,
                    source_label = EXCLUDED.source_label,
                    source_url = EXCLUDED.source_url,
                    ship_type_code = EXCLUDED.ship_type_code,
                    ship_type_label = EXCLUDED.ship_type_label,
                    payload = EXCLUDED.payload,
                    last_seen_at = EXCLUDED.last_seen_at,
                    updated_at = NOW()
                """,
                (
                    mmsi,
                    vessel.get("vessel_name"),
                    float(lat),
                    float(lng),
                    observed_at,
                    vessel.get("source_label") or "AISStream",
                    vessel.get("source_url") or "https://aisstream.io/documentation",
                    vessel.get("ship_type_code"),
                    vessel.get("ship_type_label"),
                    Json(vessel),
                    observed_at,
                ),
            )
            upserted += 1
    return upserted


def update_maritime_ingest_status(
    conn,
    *,
    status: str,
    source: str = "AISStream",
    snapshot_count: int = 0,
    last_error: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
    mark_success: bool = False,
) -> None:
    from psycopg2.extras import Json

    ensure_maritime_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO maritime_ingest_status (
                id,
                status,
                source,
                last_attempt_at,
                last_success_at,
                last_error,
                snapshot_count,
                metadata,
                updated_at
            )
            VALUES (
                %s,
                %s,
                %s,
                NOW(),
                CASE WHEN %s THEN NOW() ELSE NULL END,
                %s,
                %s,
                %s,
                NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                source = EXCLUDED.source,
                last_attempt_at = EXCLUDED.last_attempt_at,
                last_success_at = CASE
                    WHEN %s THEN EXCLUDED.last_success_at
                    ELSE maritime_ingest_status.last_success_at
                END,
                last_error = EXCLUDED.last_error,
                snapshot_count = EXCLUDED.snapshot_count,
                metadata = EXCLUDED.metadata,
                updated_at = NOW()
            """,
            (
                MARITIME_WORKER_STATUS_ID,
                status,
                source,
                mark_success,
                last_error,
                snapshot_count,
                Json(metadata or {}),
                mark_success,
            ),
        )


def get_maritime_context(
    *,
    company: str = "",
    country: str = "",
    country_iso2: str = "",
    commodity: str = "",
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    vessel_name: str = "",
    mmsi: str = "",
    imo: str = "",
    destination: str = "",
) -> dict[str, Any]:
    identity = fetch_wikidata_vessel_identity(imo=imo, mmsi=mmsi)
    relationships = build_maritime_relationships(
        identity=identity,
        vessel_name=vessel_name,
        imo=imo,
        mmsi=mmsi,
    )
    company_links = build_company_links(
        company=company or vessel_name,
        owner=(identity or {}).get("owner") or "",
        operator=(identity or {}).get("operator") or "",
    )
    matched_destination_port = match_destination_to_port(destination, country_iso2=country_iso2)
    nearest_ports = find_nearest_ports(country_iso2=country_iso2, lat=lat, lng=lng, limit=5)
    evidence = fetch_gdelt_evidence(
        company=company,
        country=country,
        commodity=commodity,
        vessel_name=vessel_name,
    )
    counterparty_proxies = build_counterparty_proxies(
        commodity=commodity,
        matched_port=matched_destination_port,
        nearest_ports=nearest_ports,
        evidence=evidence,
    )

    source_labels = ["UN/LOCODE", "GDELT DOC 2.0", "OpenCorporates search"]
    if identity:
        source_labels.append("Wikidata")

    limitations = [
        "Open/free data does not provide reliable bill-of-lading buyer/seller coverage at commercial depth.",
        "Buyer/seller context here is a proxy assembled from ports, corporate registries, Wikidata vessel links, and news evidence.",
        "GDELT evidence is news-derived and should be treated as screening context, not documentary proof of title or cargo ownership.",
    ]
    if not identity:
        limitations.append(
            "No open vessel ownership/operator match was found in Wikidata for the provided IMO/MMSI."
        )

    return {
        "source_labels": source_labels,
        "data_as_of": _now_iso(),
        "company_links": company_links,
        "nearest_ports": nearest_ports,
        "evidence": evidence,
        "identity": identity,
        "relationships": relationships,
        "counterparty_proxies": counterparty_proxies,
        "bol_coverage_note": (
            "True bill-of-lading buyer/seller data is usually commercial or government-restricted. "
            "This MVP exposes open proxies and raw evidence instead of pretending to have full B/L coverage."
        ),
        "limitations": limitations,
    }
