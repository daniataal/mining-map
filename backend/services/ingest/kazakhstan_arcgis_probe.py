"""Timeout-safe probe of Kazakhstan national ArcGIS hub (honest gap reporting).

Does NOT add layers to OPEN_DATA_SOURCES unless admin sets KZ_ARCGIS_SYNC_ENABLED=1
and KZ_ARCGIS_HYDROCARBON_LAYER_URL to a verified FeatureServer/MapServer layer URL.
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

_HYDROCARBON_KEYWORDS = (
    "petroleum",
    "oil",
    "gas",
    "hydrocarbon",
    "neft",
    "нефть",
    "газ",
    "углевод",
    "subsoil",
    "contract area",
    "license area",
)


def _user_agent() -> str:
    return os.getenv(
        "OPEN_DATA_SYNC_USER_AGENT",
        "MeridianMiningMap/1.0 (open-data probe; contact admin)",
    )


def _sync_enabled() -> bool:
    return os.getenv("KZ_ARCGIS_SYNC_ENABLED", "").strip().lower() in {"1", "true", "yes"}


def _configured_layer_url() -> str:
    return (os.getenv("KZ_ARCGIS_HYDROCARBON_LAYER_URL") or "").strip()


def discover_hydrocarbon_services(services: list[Any]) -> list[dict[str, str]]:
    """Return service entries whose name/type suggest petroleum layers."""
    matches: list[dict[str, str]] = []
    for svc in services:
        if not isinstance(svc, dict):
            continue
        name = str(svc.get("name") or "")
        svc_type = str(svc.get("type") or "")
        combined = f"{name} {svc_type}".lower()
        if any(kw in combined for kw in _HYDROCARBON_KEYWORDS):
            matches.append({"name": name, "type": svc_type})
    return matches


def probe_kazakhstan_arcgis_hub(
    *,
    url: Optional[str] = None,
    timeout: float = DEFAULT_TIMEOUT,
    urlopen: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, Any]:
    """GET the national ArcGIS REST catalog; structured result for data-health (never raises)."""
    target = (url or PROBE_URL).strip()
    started = __import__("time").time()
    layer_url = _configured_layer_url()
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
        services: list[Any] = []
        service_names: list[str] = []
        hydrocarbon_layers: list[dict[str, str]] = []
        if isinstance(payload, dict) and isinstance(payload.get("services"), list):
            services = payload["services"]
            service_count = len(services)
            service_names = [
                str(s.get("name") or "")
                for s in services[:40]
                if isinstance(s, dict) and s.get("name")
            ]
            hydrocarbon_layers = discover_hydrocarbon_services(services)
        verified_layer = bool(layer_url)
        sync_ready = verified_layer and _sync_enabled()
        return {
            "probe_key": "kazakhstan_arcgis_hub",
            "url": target,
            "reachable": True,
            "status": "reachable",
            "elapsed_ms": elapsed_ms,
            "service_count": service_count,
            "service_names_sample": service_names,
            "hydrocarbon_layer_candidates": hydrocarbon_layers,
            "hydrocarbon_candidate_count": len(hydrocarbon_layers),
            "admin_sync_enabled": _sync_enabled(),
            "configured_layer_url": layer_url or None,
            "sync_ready": sync_ready,
            "enable_when_verified_hint": (
                "Set KZ_ARCGIS_HYDROCARBON_LAYER_URL to a verified FeatureServer layer, "
                "then KZ_ARCGIS_SYNC_ENABLED=1 to add kazakhstan_petroleum_arcgis to OPEN_DATA_SOURCES."
            ),
            "message": (
                f"ArcGIS REST catalog responded in {elapsed_ms}ms"
                + (f" ({service_count} services listed)" if service_count is not None else "")
                + (
                    f"; {len(hydrocarbon_layers)} possible hydrocarbon service(s)"
                    if hydrocarbon_layers
                    else ""
                )
                + ("; sync enabled for configured layer" if sync_ready else "")
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
            "admin_sync_enabled": _sync_enabled(),
            "configured_layer_url": layer_url or None,
            "enable_when_verified_hint": (
                "Hub unreachable — verify arcgis.gis-center.kz from production network before enabling sync."
            ),
            "message": f"HTTP {exc.code} from ArcGIS hub (not verified for sync)",
        }
    except Exception as exc:
        elapsed_ms = int((__import__("time").time() - started) * 1000)
        err_name = type(exc).__name__
        is_timeout = "timeout" in str(exc).lower() or err_name == "TimeoutError"
        return {
            "probe_key": "kazakhstan_arcgis_hub",
            "url": target,
            "reachable": False,
            "status": "timeout" if is_timeout else "error",
            "elapsed_ms": elapsed_ms,
            "admin_sync_enabled": _sync_enabled(),
            "configured_layer_url": layer_url or None,
            "enable_when_verified_hint": (
                "Probe timed out from this network — egov.kz mining register remains the honest fallback."
                if is_timeout
                else "Fix network/DNS to arcgis.gis-center.kz before enabling unattended sync."
            ),
            "message": f"{err_name}: {exc} — no stable public petroleum layer wired",
        }


def optional_kazakhstan_petroleum_source():
    """ArcGIS source appended to OPEN_DATA_SOURCES when admin verified layer URL + flag set."""
    layer_url = _configured_layer_url()
    if not layer_url or not _sync_enabled():
        return None
    try:
        from backend.services.ingest.open_data_sync import ArcGISOpenDataSource
    except ImportError:
        from services.ingest.open_data_sync import ArcGISOpenDataSource

    return ArcGISOpenDataSource(
        source_id="kazakhstan_petroleum_arcgis",
        source_name="Kazakhstan Petroleum Contract Areas (ArcGIS hub)",
        layer_url=layer_url,
        sector="oil_and_gas",
        country="Kazakhstan",
        external_id_fields=("OBJECTID", "FID", "ID"),
        company_fields=("COMPANY", "OPERATOR", "LICENSEE", "HOLDER"),
        country_fields=("COUNTRY",),
        commodity_fields=("COMMODITY", "RESOURCE"),
        status_fields=("STATUS",),
        default_commodity="Oil & Gas",
        default_license_type="Petroleum contract area",
        default_status="Active",
        max_records=int(os.getenv("KZ_ARCGIS_SYNC_MAX_RECORDS", "1500")),
        page_size=250,
        record_origin="open_data",
        metadata={
            "kind": "official_arcgis_registry",
            "coverage": "kazakhstan",
            "note": "Enabled via KZ_ARCGIS_SYNC_ENABLED after manual layer verification.",
            "probe_url": PROBE_URL,
        },
    )


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
    probe_key = result.get("probe_key") or "kazakhstan_arcgis_hub"
    previous = get_latest_probe(conn, probe_key=probe_key)
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
                probe_key,
                bool(result.get("reachable")),
                str(result.get("status") or "unknown"),
                result.get("elapsed_ms"),
                json.dumps(result),
            ),
        )
    try:
        from backend.services.sync_alert_store import record_probe_status_change
    except ImportError:
        from services.sync_alert_store import record_probe_status_change
    record_probe_status_change(conn, probe_key=probe_key, previous=previous, current=result)


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
