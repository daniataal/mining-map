"""Shared Redis client kwargs for cache and maritime snapshot writers."""

from __future__ import annotations

import os
from typing import Any


def redis_password() -> str:
    return (os.getenv("REDIS_PASSWORD") or "").strip()


def redis_client_kwargs() -> dict[str, Any]:
    host = (os.getenv("REDIS_HOST") or "").strip()
    port = int(os.getenv("REDIS_PORT", "6379"))
    kwargs: dict[str, Any] = {
        "host": host,
        "port": port,
        "decode_responses": True,
        "socket_connect_timeout": 2,
        "socket_timeout": 2,
    }
    password = redis_password()
    if password:
        kwargs["password"] = password
    return kwargs
