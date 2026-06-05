"""Thin proxy to Go oil-live-intel for retired Python maritime API routes."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Mapping, Optional, Union

OIL_INTEL_API_URL = (os.getenv("OIL_INTEL_API_URL") or "http://oil-live-intel:8095").rstrip("/")

JsonBody = Union[dict[str, Any], list[Any]]


def _build_oil_live_url(path: str, params: Optional[Mapping[str, Any]] = None) -> str:
    base = path if path.startswith("/") else f"/{path}"
    query = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
    url = f"{OIL_INTEL_API_URL}{base}"
    if query:
        url = f"{url}?{query}"
    return url


def proxy_oil_live_get(path: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Forward GET to oil-live-intel; return JSON body or error-shaped dict."""
    body, status, _ = proxy_oil_live_get_forward(path, params)
    if status >= 400:
        if isinstance(body, dict):
            parsed = dict(body)
        else:
            parsed = {"error": body if isinstance(body, str) else f"HTTP {status}"}
        parsed.setdefault("proxy_error", True)
        parsed.setdefault("upstream_status", status)
        return parsed
    if isinstance(body, (dict, list)):
        return body
    return {}


def proxy_oil_live_get_forward(
    path: str,
    params: Optional[Mapping[str, Any]] = None,
) -> tuple[JsonBody | str, int, str]:
    """Forward GET to oil-live-intel; return (body, status, content_type)."""
    url = _build_oil_live_url(path, params)
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "mining-backend-proxy/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            content_type = resp.headers.get_content_type() or "application/json"
            if content_type.startswith("application/json"):
                payload: JsonBody | str = json.loads(raw.decode("utf-8")) if raw else {}
            else:
                payload = raw.decode("utf-8", errors="replace")
            return payload, resp.status, content_type
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        content_type = exc.headers.get_content_type() or "application/json"
        if content_type.startswith("application/json"):
            try:
                payload = json.loads(raw.decode("utf-8")) if raw else {}
            except json.JSONDecodeError:
                payload = {"error": raw.decode("utf-8", errors="replace") or f"HTTP {exc.code}"}
        else:
            payload = raw.decode("utf-8", errors="replace") or f"HTTP {exc.code}"
        return payload, exc.code, content_type
    except Exception as exc:
        return {"error": str(exc), "proxy_error": True, "upstream": url}, 502, "application/json"


def proxy_oil_live_get_bytes(path: str) -> tuple[bytes, int, dict[str, str]]:
    """Forward GET to oil-live-intel; return raw body, HTTP status, and response headers."""
    base = path if path.startswith("/") else f"/{path}"
    url = f"{OIL_INTEL_API_URL}{base}"
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/vnd.mapbox-vector-tile,*/*", "User-Agent": "mining-backend-proxy/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            headers = {k.lower(): v for k, v in resp.headers.items()}
            return resp.read(), resp.status, headers
    except urllib.error.HTTPError as exc:
        headers = {k.lower(): v for k, v in exc.headers.items()}
        return exc.read(), exc.code, headers
    except Exception:
        return b"", 502, {}
