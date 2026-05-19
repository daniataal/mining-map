"""Timeout-safe probe of Kazakhstan national ArcGIS hub (honest gap reporting).

Does NOT add layers to OPEN_DATA_SOURCES — results surface in admin data-health only.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Optional

PROBE_URL = os.getenv(
    "KZ_ARCGIS_PROBE_URL",
    "https://arcgis.gis-center.kz/server/rest/services?f=json",
)
DEFAULT_TIMEOUT = max(3.0, float(os.getenv("KZ_ARCGIS_PROBE_TIMEOUT_SECONDS", "12")))


def _user_agent() -> str:
    return os.getenv(
        "OPEN_DATA_SYNC_USER_AGENT",
        "MeridianMiningMap/1.0 (open-data probe; contact admin)",
    )


def probe_kazakhstan_arcgis_hub(
    *,
    url: Optional[str] = None,
    timeout: float = DEFAULT_TIMEOUT,
    urlopen: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, Any]:
    """GET the national ArcGIS REST catalog; structured result for data-health (never raises)."""
    target = (url or PROBE_URL).strip()
    started = __import__("time").time()
    try:
        req = urllib.request.Request(target, headers={"User-Agent": _user_agent(), "Accept": "application/json"})
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
        elapsed_ms = int((__import__("time").time() - started) * 1000)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = None
        service_count = None
        if isinstance(payload, dict) and isinstance(payload.get("services"), list):
            service_count = len(payload["services"])
        return {
            "probe_key": "kazakhstan_arcgis_hub",
            "url": target,
            "reachable": True,
            "status": "reachable",
            "elapsed_ms": elapsed_ms,
            "service_count": service_count,
            "message": (
                f"ArcGIS REST catalog responded in {elapsed_ms}ms"
                + (f" ({service_count} services listed)" if service_count is not None else "")
            ),
        }
    except urllib.error.HTTPError as exc:
        elapsed_ms = int((__import__("time").time() - started) * 1000)
        return {
            "probe_key": "kazakhstan_arcgis_hub",
            "url": target,
            "reachable": False,
            "status": "http_error",
            "elapsed_ms": elapsed_ms,
            "http_status": exc.code,
            "message": f"HTTP {exc.code} from ArcGIS hub (not verified for sync)",
        }
    except Exception as exc:
        elapsed_ms = int((__import__("time").time() - started) * 1000)
        err_name = type(exc).__name__
        return {
            "probe_key": "kazakhstan_arcgis_hub",
            "url": target,
            "reachable": False,
            "status": "timeout" if "timeout" in str(exc).lower() or err_name == "TimeoutError" else "error",
            "elapsed_ms": elapsed_ms,
            "message": f"{err_name}: {exc} — no stable public petroleum layer wired",
        }


def ensure_probe_tables(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS open_data_probe_results (
                probe_key TEXT PRIMARY KEY,
                checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                reachable BOOLEAN NOT NULL DEFAULT FALSE,
                status TEXT NOT NULL,
                elapsed_ms INTEGER,
                payload JSONB NOT NULL DEFAULT '{}'::jsonb
            );
            """
        )


def persist_probe_result(conn: Any, result: dict[str, Any]) -> None:
    ensure_probe_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO open_data_probe_results (probe_key, checked_at, reachable, status, elapsed_ms, payload)
            VALUES (%s, NOW(), %s, %s, %s, %s::jsonb)
            ON CONFLICT (probe_key) DO UPDATE SET
                checked_at = NOW(),
                reachable = EXCLUDED.reachable,
                status = EXCLUDED.status,
                elapsed_ms = EXCLUDED.elapsed_ms,
                payload = EXCLUDED.payload;
            """,
            (
                result.get("probe_key") or "kazakhstan_arcgis_hub",
                bool(result.get("reachable")),
                str(result.get("status") or "unknown"),
                result.get("elapsed_ms"),
                json.dumps(result),
            ),
        )


def get_latest_probe(conn: Any, probe_key: str = "kazakhstan_arcgis_hub") -> Optional[dict[str, Any]]:
    ensure_probe_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT checked_at, reachable, status, elapsed_ms, payload
            FROM open_data_probe_results
            WHERE probe_key = %s;
            """,
            (probe_key,),
        )
        row = cur.fetchone()
    if not row:
        return None
    if isinstance(row, dict):
        payload = row.get("payload")
        checked_at = row.get("checked_at")
        return {
            "probe_key": probe_key,
            "checked_at": checked_at.isoformat() if hasattr(checked_at, "isoformat") else checked_at,
            "reachable": row.get("reachable"),
            "status": row.get("status"),
            "elapsed_ms": row.get("elapsed_ms"),
            **(payload if isinstance(payload, dict) else {}),
        }
    checked_at, reachable, status, elapsed_ms, payload = row
    base = payload if isinstance(payload, dict) else {}
    if isinstance(payload, str):
        try:
            base = json.loads(payload)
        except json.JSONDecodeError:
            base = {}
    return {
        "probe_key": probe_key,
        "checked_at": checked_at.isoformat() if hasattr(checked_at, "isoformat") else checked_at,
        "reachable": reachable,
        "status": status,
        "elapsed_ms": elapsed_ms,
        **base,
    }


def run_and_persist_probe(conn: Any) -> dict[str, Any]:
    result = probe_kazakhstan_arcgis_hub()
    persist_probe_result(conn, result)
    return result
