"""Probe Philippines MGB ControlMap ArcGIS (token-gated; data-health only).

Does NOT add layers to OPEN_DATA_SOURCES — results surface in admin data-health and
WORLD_COVERAGE_OVERRIDES remain official_api_restricted until a stable public query works.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Optional

PROBE_LAYER_URL = os.getenv(
    "PH_MGB_ARCGIS_LAYER_URL",
    "https://controlmap.mgb.gov.ph/arcgis/rest/services/GeospatialDataInventory_Public/"
    "GDI_Approved_Mining_Tenement_Public/FeatureServer/0",
)
DEFAULT_TIMEOUT = max(3.0, float(os.getenv("PH_MGB_ARCGIS_PROBE_TIMEOUT_SECONDS", "15")))
PROBE_KEY = "philippines_mgb_arcgis"


def _user_agent() -> str:
    return os.getenv(
        "OPEN_DATA_SYNC_USER_AGENT",
        "MeridianMiningMap/1.0 (open-data probe; contact admin)",
    )


def _token_configured() -> Optional[str]:
    return (os.getenv("PH_MGB_ARCGIS_TOKEN") or "").strip() or None


def probe_philippines_mgb_arcgis(
    *,
    layer_url: Optional[str] = None,
    timeout: float = DEFAULT_TIMEOUT,
    urlopen: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, Any]:
    """Probe MGB mining tenement FeatureServer; never raises."""
    target_layer = (layer_url or PROBE_LAYER_URL).strip()
    started = __import__("time").time()
    token = _token_configured()

    def _query_url(with_token: Optional[str]) -> str:
        params: dict[str, str] = {"where": "1=1", "returnCountOnly": "true", "f": "json"}
        if with_token:
            params["token"] = with_token
        return f"{target_layer.rstrip('/')}/query?{urllib.parse.urlencode(params)}"

    def _attempt(with_token: Optional[str]) -> dict[str, Any] | None:
        req = urllib.request.Request(
            _query_url(with_token),
            headers={"User-Agent": _user_agent(), "Accept": "application/json"},
        )
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

    def _elapsed() -> int:
        return int((__import__("time").time() - started) * 1000)

    def _base(**extra: Any) -> dict[str, Any]:
        return {
            "probe_key": PROBE_KEY,
            "url": target_layer,
            "token_configured": bool(token),
            **extra,
        }

    try:
        payload = _attempt(None)
        elapsed_ms = _elapsed()
        if isinstance(payload, dict):
            if payload.get("count") is not None:
                count = int(payload["count"])
                return _base(
                    reachable=True,
                    status="reachable",
                    elapsed_ms=elapsed_ms,
                    feature_count=count,
                    message=(
                        f"MGB mining tenement layer responded without token ({count} features reported)"
                    ),
                )
            err = payload.get("error")
            if isinstance(err, dict):
                code = err.get("code")
                detail = str(err.get("message") or err.get("details") or "")
                token_required = code in (498, 499) or "token" in detail.lower()
                if token_required:
                    if not token:
                        return _base(
                            reachable=False,
                            status="token_required",
                            elapsed_ms=elapsed_ms,
                            http_status=None,
                            message=(
                                "ArcGIS layer requires token for feature queries — set PH_MGB_ARCGIS_TOKEN "
                                "to probe with credentials (sync not enabled)"
                            ),
                        )
                    payload2 = _attempt(token)
                    elapsed_ms = _elapsed()
                    if isinstance(payload2, dict) and payload2.get("count") is not None:
                        count = int(payload2["count"])
                        return _base(
                            reachable=True,
                            status="reachable_with_token",
                            elapsed_ms=elapsed_ms,
                            feature_count=count,
                            message=f"MGB layer reachable with token ({count} features)",
                        )
                    err2 = payload2.get("error") if isinstance(payload2, dict) else None
                    msg2 = ""
                    if isinstance(err2, dict):
                        msg2 = str(err2.get("message") or "")
                    return _base(
                        reachable=False,
                        status="token_rejected",
                        elapsed_ms=elapsed_ms,
                        message=f"Token probe failed: {msg2 or 'unknown ArcGIS error'}",
                    )
        return _base(
            reachable=False,
            status="unexpected_response",
            elapsed_ms=elapsed_ms,
            message="Unexpected ArcGIS response (not verified for unattended sync)",
        )
    except urllib.error.HTTPError as exc:
        elapsed_ms = _elapsed()
        body_snip = ""
        try:
            body_snip = exc.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            pass
        token_hint = exc.code in (401, 403) or "token" in body_snip.lower()
        return _base(
            reachable=False,
            status="token_required" if token_hint else "http_error",
            elapsed_ms=elapsed_ms,
            http_status=exc.code,
            message=f"HTTP {exc.code} from MGB ControlMap (not verified for sync)",
        )
    except Exception as exc:
        elapsed_ms = _elapsed()
        err_name = type(exc).__name__
        return _base(
            reachable=False,
            status="timeout" if "timeout" in str(exc).lower() or err_name == "TimeoutError" else "error",
            elapsed_ms=elapsed_ms,
            message=f"{err_name}: {exc} — Philippines mining tenement sync not wired",
        )


def run_and_persist_probe(conn: Any) -> dict[str, Any]:
    try:
        from backend.services.ingest.kazakhstan_arcgis_probe import persist_probe_result
    except ImportError:
        from services.ingest.kazakhstan_arcgis_probe import persist_probe_result

    result = probe_philippines_mgb_arcgis()
    persist_probe_result(conn, result)
    return result


def get_latest_probe(conn: Any, probe_key: str = PROBE_KEY) -> Optional[dict[str, Any]]:
    try:
        from backend.services.ingest.kazakhstan_arcgis_probe import get_latest_probe as _get
    except ImportError:
        from services.ingest.kazakhstan_arcgis_probe import get_latest_probe as _get

    return _get(conn, probe_key=probe_key)
