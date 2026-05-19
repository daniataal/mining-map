"""UN Comtrade API key resolution and primary→secondary failover."""

from __future__ import annotations

import os
from typing import Any, Callable, Optional

PRIMARY_ENV = "COMTRADE_API_KEY"
SECONDARY_ENV = "COMTRADE_API_KEY_SECONDARY"

# Quota / auth failures on primary → one retry with secondary key.
FAILOVER_HTTP_STATUS = frozenset({429, 403})


def primary_key(explicit: Optional[str] = None) -> str:
    if explicit is not None:
        return explicit.strip()
    return (os.getenv(PRIMARY_ENV) or "").strip()


def secondary_key() -> str:
    return (os.getenv(SECONDARY_ENV) or "").strip()


def should_failover(status_code: int, *, used_key: str) -> bool:
    sec = secondary_key()
    return bool(sec) and sec != used_key and status_code in FAILOVER_HTTP_STATUS


def get_json_with_key_failover(
    build_url: Callable[[str], str],
    *,
    api_key: Optional[str] = None,
    timeout: float = 15,
) -> tuple[Optional[dict[str, Any]], int]:
    """
    GET a keyed Comtrade URL built by ``build_url(subscription_key)``.

    Tries ``COMTRADE_API_KEY`` (or ``api_key``); on HTTP 429/403 retries once
    with ``COMTRADE_API_KEY_SECONDARY`` when set.
    """
    try:
        import requests
    except ImportError:  # pragma: no cover
        return None, 0

    key = primary_key(api_key)
    if not key:
        return None, 0

    for attempt_key in _keys_to_try(key):
        try:
            r = requests.get(build_url(attempt_key), timeout=timeout)
        except Exception:
            return None, 0
        if r.status_code == 200:
            try:
                return r.json(), 200
            except Exception:
                return None, r.status_code
        if attempt_key == key and should_failover(r.status_code, used_key=key):
            continue
        return None, r.status_code
    return None, 0


def _keys_to_try(primary: str) -> list[str]:
    sec = secondary_key()
    if sec and sec != primary:
        return [primary, sec]
    return [primary]
