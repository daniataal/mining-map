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
GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
UNLOCODE_CSV_URL = "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv"
WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql"

REQUEST_TIMEOUT_SECONDS = 12
UNLOCODE_CACHE_TTL_SECONDS = 60 * 60 * 24
AIS_CACHE_TTL_SECONDS = 60
AIS_DEFAULT_MAX_VESSELS = 300
AIS_MAX_VESSELS = 2000
AIS_DEFAULT_CAPTURE_WINDOW_SECONDS = 10
AIS_MIN_CAPTURE_WINDOW_SECONDS = 4
AIS_MAX_CAPTURE_WINDOW_SECONDS = 18
AIS_MAX_VIEWPORT_WIDTH_DEGREES = 90.0
AIS_MAX_VIEWPORT_HEIGHT_DEGREES = 55.0
AIS_MAX_FALLBACK_REGION_COUNT = 6
MARITIME_SNAPSHOT_TTL_SECONDS = int(os.getenv("MARITIME_SNAPSHOT_TTL_SECONDS", "300"))
MARITIME_SNAPSHOT_RETENTION_SECONDS = int(os.getenv("MARITIME_SNAPSHOT_RETENTION_SECONDS", str(60 * 60 * 24)))
MARITIME_WORKER_STATUS_ID = "aisstream"

# Curated fallback regions used when a viewport is absent or too wide to watch
# honestly as a single AIS subscription. Bboxes are (south, west, north, east).
AISSTREAM_WATCH_REGIONS = [
    {"id": "arabian_gulf", "label": "Arabian Gulf", "bbox": (18.0, 47.0, 30.0, 58.5)},
    {"id": "red_sea_suez", "label": "Red Sea and Suez", "bbox": (12.0, 29.0, 32.5, 44.0)},
    {"id": "east_mediterranean", "label": "Mediterranean", "bbox": (30.0, -7.0, 46.0, 37.0)},
    {"id": "west_africa", "label": "West Africa offshore", "bbox": (-30.0, -20.0, 14.0, 20.0)},
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


def _normalize_vessel_scope(scope: str) -> str:
    return "all_vessels" if _clean_text(scope).lower() == "all_vessels" else "oil_tankers"


def _ship_matches_scope(ship_type_label: str, vessel_scope: str) -> bool:
    normalized_scope = _normalize_vessel_scope(vessel_scope)
    if normalized_scope == "all_vessels":
        return True
    return ship_type_label == "Tanker"


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
            "Scope is limited to tanker-class AIS snapshots persisted by the maritime worker."
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
        "geography_mode": plan.get("geography_mode"),
        "geography_note": plan.get("geography_note"),
        "requested_bbox": plan.get("requested_bbox"),
        "effective_bbox_count": len(plan.get("boxes") or []),
        "region_labels": plan.get("region_labels") or [],
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


def _build_ais_subscription_plan(
    viewport_bbox: Optional[tuple[float, float, float, float]] = None,
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
        sampled_regions = intersecting_regions[:AIS_MAX_FALLBACK_REGION_COUNT]
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

    sampled_regions = AISSTREAM_WATCH_REGIONS[:AIS_MAX_FALLBACK_REGION_COUNT]
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
    plan = _build_ais_subscription_plan(viewport_bbox)
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
                max(normalized_max_vessels * (4 if normalized_scope == "oil_tankers" else 2), 40),
                4000,
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

    results.sort(key=lambda item: str(item.get("observed_at") or ""), reverse=True)
    source_label = {
        "viewport_bbox": "AISStream viewport watch",
        "sampled_viewport_regions": "AISStream sampled viewport watch",
        "default_regions": "AISStream regional watch",
    }.get(plan.get("geography_mode"), "AISStream watch")

    limitations = []
    if plan.get("geography_note"):
        limitations.append(str(plan["geography_note"]))
    if normalized_scope == "oil_tankers":
        limitations.append(
            "Scope is limited to tanker-class AIS messages for an oil-focused watch. Switch to all vessels to widen coverage."
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


def get_maritime_vessel_feed(
    *,
    max_vessels: int = AIS_DEFAULT_MAX_VESSELS,
    capture_window_seconds: int = AIS_DEFAULT_CAPTURE_WINDOW_SECONDS,
    vessel_scope: str = "oil_tankers",
    bbox: Optional[tuple[float, float, float, float]] = None,
    offset: int = 0,
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
        from psycopg2.extras import RealDictCursor

        ensure_maritime_tables(conn)
        where = ["last_seen_at >= NOW() - (%s * INTERVAL '1 second')"]
        params: list[Any] = [MARITIME_SNAPSHOT_RETENTION_SECONDS]
        if normalized_scope != "all_vessels":
            where.append("ship_type_label = %s")
            params.append("Tanker")
        if normalized_bbox is not None:
            south, west, north, east = normalized_bbox
            where.append("lat BETWEEN %s AND %s")
            params.extend([south, north])
            where.append("lng BETWEEN %s AND %s")
            params.extend([west, east])
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            count_where = list(where)
            count_params: list[Any] = list(params)
            cur.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM maritime_vessel_snapshots
                WHERE {" AND ".join(count_where)}
                """,
                tuple(count_params),
            )
            count_row = cur.fetchone()
            total_available = int((count_row or {}).get("total") or 0)

        params.extend([normalized_max_vessels, normalized_offset])

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
                WHERE {" AND ".join(where)}
                ORDER BY last_seen_at DESC, observed_at DESC NULLS LAST
                LIMIT %s
                OFFSET %s
                """,
                tuple(params),
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
        return _build_stored_feed_response(
            rows=rows,
            status=dict(status_row) if status_row else None,
            max_vessels=normalized_max_vessels,
            offset=normalized_offset,
            total_available=total_available,
            capture_window_seconds=normalized_window,
            vessel_scope=normalized_scope,
            bbox=normalized_bbox,
        )
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
