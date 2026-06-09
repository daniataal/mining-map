"""Per-client rate limiting for expensive backend endpoints (Redis with in-memory fallback)."""

from __future__ import annotations

import hashlib
import os
import threading
import time
from typing import Callable, Optional

try:
    from fastapi import Request
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import JSONResponse
except ImportError:  # pragma: no cover - import guard for unit tests
    Request = object  # type: ignore[misc, assignment]
    BaseHTTPMiddleware = object  # type: ignore[misc, assignment]
    JSONResponse = object  # type: ignore[misc, assignment]


def _env_bool(key: str, default: bool) -> bool:
    raw = (os.getenv(key) or "").strip().lower()
    if raw == "":
        return default
    return raw in {"1", "true", "yes", "on"}


def _env_int(key: str, default: int) -> int:
    raw = (os.getenv(key) or "").strip()
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


RATE_LIMIT_ENABLED = _env_bool("RATE_LIMIT_ENABLED", False)
RATE_LIMIT_RPM = _env_int("RATE_LIMIT_RPM", 30)
RATE_LIMIT_ROUTE_RPM = _env_int("RATE_LIMIT_ROUTE_RPM", 60)
RATE_LIMIT_WINDOW_SEC = 60

_memory_lock = threading.Lock()
_memory_counts: dict[str, tuple[int, int]] = {}


def _redis_client():
    host = (os.getenv("REDIS_HOST") or "").strip()
    if not host:
        return None
    try:
        import redis

        try:
            from backend.services.redis_connection import redis_client_kwargs
        except ImportError:
            from services.redis_connection import redis_client_kwargs

        return redis.Redis(**redis_client_kwargs())
    except Exception:
        return None


def client_key(request: Request) -> str:
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer ") and len(auth) > 7:
        token = auth[7:].strip()
        if token:
            return "user:" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:24]
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return "ip:" + forwarded
    client = request.client
    host = client.host if client else "unknown"
    return "ip:" + host


def path_limit(path: str) -> Optional[tuple[str, int]]:
    """Return (bucket, rpm) when path is rate-limited."""
    if path.startswith("/api/agents"):
        return "agents", RATE_LIMIT_RPM
    if path.startswith("/api/routing"):
        return "routing", RATE_LIMIT_ROUTE_RPM
    if path == "/licenses/export":
        return "export", RATE_LIMIT_RPM
    if path.startswith("/api/deal-rooms/") and (
        path.endswith("/export") or path.endswith("/export.pdf")
    ):
        return "export", RATE_LIMIT_RPM
    return None


def _memory_allow(key: str, limit: int, window_sec: int) -> bool:
    window = int(time.time()) // window_sec
    with _memory_lock:
        count, stored_window = _memory_counts.get(key, (0, window))
        if stored_window != window:
            count = 0
            stored_window = window
        count += 1
        _memory_counts[key] = (count, stored_window)
        if len(_memory_counts) > 10_000:
            cutoff = window - 2
            stale = [k for k, (_, w) in _memory_counts.items() if w < cutoff]
            for k in stale:
                _memory_counts.pop(k, None)
        return count <= limit


def _redis_allow(client, key: str, limit: int, window_sec: int) -> Optional[bool]:
    try:
        count = client.incr(key)
        if count == 1:
            client.expire(key, window_sec)
        return int(count) <= limit
    except Exception:
        return None


def allow_request(client_key: str, bucket: str, limit: int, window_sec: int = RATE_LIMIT_WINDOW_SEC) -> bool:
    redis_key = f"rl:{bucket}:{client_key}:{int(time.time()) // window_sec}"
    client = _redis_client()
    if client is not None:
        allowed = _redis_allow(client, redis_key, limit, window_sec)
        if allowed is not None:
            return allowed
    return _memory_allow(redis_key, limit, window_sec)


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if not RATE_LIMIT_ENABLED or request.method not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
            return await call_next(request)

        spec = path_limit(request.url.path)
        if spec is None:
            return await call_next(request)

        bucket, limit = spec
        key = client_key(request)
        if not allow_request(key, bucket, limit):
            return JSONResponse(
                status_code=429,
                content={
                    "error": "rate_limit_exceeded",
                    "message": f"Too many requests ({limit} per minute). Try again shortly.",
                    "bucket": bucket,
                },
            )
        return await call_next(request)


def reset_memory_store_for_tests() -> None:
    with _memory_lock:
        _memory_counts.clear()
