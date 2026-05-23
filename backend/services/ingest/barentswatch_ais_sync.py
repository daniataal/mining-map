"""BarentsWatch open government AIS — regional Norway EEZ (MAD-45 matrix row / MAD-61).

Docs: https://developer.barentswatch.no/docs/AIS/live-ais-api/
Free Norwegian Coastal Administration AIS within Norway EEZ; not Gulf/Africa coverage.

Without ``BARENTSWATCH_CLIENT_ID`` + ``BARENTSWATCH_CLIENT_SECRET`` sync skips and
``maritime_source_health`` stays at ``configured_awaiting_credentials``.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

SOURCE_ID = "barentswatch"
SOURCE_TYPE = "government_ais"
SOURCE_URL = "https://developer.barentswatch.no/docs/AIS/live-ais-api/"
LIVE_API_BASE = "https://live.ais.barentswatch.no/v1"
TOKEN_URL = "https://id.barentswatch.no/connect/token"

# Sample verify bbox (west, south, east, north) — Norwegian waters
DEFAULT_VERIFY_BBOX = (4.0, 58.0, 31.0, 71.0)

SYNC_ENABLED = (os.getenv("BARENTSWATCH_AIS_SYNC_ENABLED") or "true").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
DEFAULT_MAX_VESSELS = max(50, int(os.getenv("BARENTSWATCH_AIS_MAX_VESSELS", "500") or "500"))
REQUEST_TIMEOUT_SECONDS = max(8, int(os.getenv("BARENTSWATCH_AIS_TIMEOUT_SECONDS", "20") or "20"))


def _client_credentials() -> tuple[Optional[str], Optional[str]]:
    client_id = (os.getenv("BARENTSWATCH_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("BARENTSWATCH_CLIENT_SECRET") or "").strip()
    return client_id or None, client_secret or None


def credentials_configured() -> bool:
    client_id, client_secret = _client_credentials()
    return bool(client_id and client_secret)


def fetch_access_token(
    *,
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
    opener: Any = None,
) -> str:
    cid = (client_id or _client_credentials()[0] or "").strip()
    secret = (client_secret or _client_credentials()[1] or "").strip()
    if not cid or not secret:
        raise RuntimeError("BARENTSWATCH_CLIENT_ID and BARENTSWATCH_CLIENT_SECRET required")

    body = urllib.parse.urlencode(
        {
            "client_id": cid,
            "client_secret": secret,
            "scope": "ais",
            "grant_type": "client_credentials",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    open_fn = opener or urllib.request.urlopen
    with open_fn(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    token = (payload.get("access_token") or "").strip()
    if not token:
        raise RuntimeError("BarentsWatch token response missing access_token")
    return token


def fetch_latest_positions(
    token: str,
    *,
    max_vessels: int = DEFAULT_MAX_VESSELS,
    opener: Any = None,
) -> list[dict[str, Any]]:
    """GET /v1/latest/combined — JSON array of latest positions."""
    req = urllib.request.Request(
        f"{LIVE_API_BASE}/latest/combined",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    open_fn = opener or urllib.request.urlopen
    with open_fn(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if not isinstance(payload, list):
        raise RuntimeError("BarentsWatch latest/combined did not return a JSON array")
    return [row for row in payload[: max(1, max_vessels)] if isinstance(row, dict)]


def _parse_observed_at(raw: Any) -> datetime:
    if isinstance(raw, datetime):
        dt = raw
    else:
        text = str(raw or "").strip().replace("Z", "+00:00")
        if not text:
            return datetime.now(timezone.utc)
        dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_mmsi(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _parse_optional_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_position(row: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Map one BarentsWatch row to vessel_position_observations batch shape."""
    mmsi = _parse_mmsi(row.get("mmsi"))
    lat = _parse_optional_float(row.get("latitude"))
    lng = _parse_optional_float(row.get("longitude"))
    if mmsi is None or lat is None or lng is None:
        return None

    imo_raw = row.get("imoNumber") or row.get("imo")
    imo = str(imo_raw).strip() if imo_raw not in (None, "", 0) else None

    return {
        "mmsi": mmsi,
        "data_source": SOURCE_ID,
        "source_record_id": f"bw:{mmsi}",
        "lat": lat,
        "lng": lng,
        "observed_at": _parse_observed_at(row.get("msgtime")),
        "sog": _parse_optional_float(row.get("speedOverGround")),
        "cog": _parse_optional_float(row.get("courseOverGround")),
        "vessel_name": (row.get("name") or "").strip() or None,
        "imo": imo,
        "source_type": SOURCE_TYPE,
        "confidence": 0.85,
        "source_url": SOURCE_URL,
        "raw": {
            **row,
            "coverage_note": (
                "Regional Norwegian government AIS (BarentsWatch). "
                "Does not cover Gulf/Africa trader corridors."
            ),
            "bol_tier": "live",
        },
    }


def update_source_health(
    conn: Any,
    *,
    status: str,
    observation_count: int = 0,
    last_observation_at: Optional[datetime] = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO maritime_source_health (
              source, source_type, display_name, status, coverage_tier,
              last_observation_at, observation_count, source_url, updated_at
            ) VALUES (
              %s, %s, 'BarentsWatch Live AIS', %s, 'open_government_regional',
              %s, %s, %s, now()
            )
            ON CONFLICT (source) DO UPDATE SET
              status = EXCLUDED.status,
              last_observation_at = COALESCE(EXCLUDED.last_observation_at, maritime_source_health.last_observation_at),
              observation_count = GREATEST(maritime_source_health.observation_count, EXCLUDED.observation_count),
              updated_at = now()
            """,
            (
                SOURCE_ID,
                SOURCE_TYPE,
                status,
                last_observation_at,
                observation_count,
                SOURCE_URL,
            ),
        )


def sync_barentswatch_ais(
    conn: Any,
    *,
    max_vessels: int = DEFAULT_MAX_VESSELS,
    fetch_token: Any = None,
    fetch_positions: Any = None,
) -> dict[str, Any]:
    """
    Pull latest Norwegian government AIS positions into oil_vessel_position_observations.

    Registered on graph-sync as step ``barentswatch_ais``.
    """
    if not SYNC_ENABLED:
        return {"status": "skipped", "reason": "BARENTSWATCH_AIS_SYNC_ENABLED is off", "source_id": SOURCE_ID}

    if not credentials_configured():
        try:
            update_source_health(conn, status="configured_awaiting_credentials")
        except Exception as exc:
            logger.debug("maritime_source_health update skipped: %s", exc)
        return {
            "status": "skipped",
            "reason": "BARENTSWATCH_CLIENT_ID / BARENTSWATCH_CLIENT_SECRET not set",
            "source_id": SOURCE_ID,
            "verify_bbox": DEFAULT_VERIFY_BBOX,
        }

    token_fn = fetch_token or fetch_access_token
    positions_fn = fetch_positions or fetch_latest_positions

    try:
        try:
            from backend.services.vessel_position_observations import (
                batch_upsert_observations,
                refresh_coverage_cells,
            )
        except ImportError:
            from services.vessel_position_observations import (
                batch_upsert_observations,
                refresh_coverage_cells,
            )

        token = token_fn()
        raw_rows = positions_fn(token, max_vessels=max_vessels)
        batch_rows = [row for row in (normalize_position(r) for r in raw_rows) if row]
        upserted = batch_upsert_observations(conn, batch_rows) if batch_rows else 0
        coverage = refresh_coverage_cells(conn) if upserted else {"status": "skipped", "upserted": 0}

        last_at = max((r["observed_at"] for r in batch_rows), default=None) if batch_rows else None
        update_source_health(
            conn,
            status="active",
            observation_count=upserted,
            last_observation_at=last_at,
        )

        return {
            "status": "ok",
            "source_id": SOURCE_ID,
            "fetched": len(raw_rows),
            "upserted": upserted,
            "coverage_cells": coverage,
            "verify_bbox": DEFAULT_VERIFY_BBOX,
            "source_url": SOURCE_URL,
        }
    except Exception as exc:
        logger.warning("BarentsWatch AIS sync failed: %s", exc)
        try:
            update_source_health(conn, status="error")
        except Exception:
            pass
        return {
            "status": "error",
            "source_id": SOURCE_ID,
            "error": str(exc),
            "verify_bbox": DEFAULT_VERIFY_BBOX,
        }
