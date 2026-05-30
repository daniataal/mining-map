"""Thin proxy to Go oil-live-intel for retired Python maritime API routes."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

OIL_INTEL_API_URL = (os.getenv("OIL_INTEL_API_URL") or "http://oil-live-intel:8095").rstrip("/")


def proxy_oil_live_get(path: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Forward GET to oil-live-intel; return JSON body or error-shaped dict."""
    base = path if path.startswith("/") else f"/{path}"
    query = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
    url = f"{OIL_INTEL_API_URL}{base}"
    if query:
        url = f"{url}?{query}"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "mining-backend-proxy/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = resp.read().decode("utf-8")
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"error": body or f"HTTP {exc.code}"}
        parsed.setdefault("proxy_error", True)
        parsed.setdefault("upstream_status", exc.code)
        return parsed
    except Exception as exc:
        return {"error": str(exc), "proxy_error": True, "upstream": url}
