"""Platform health aggregation for /api/health."""

from __future__ import annotations

from typing import Any, Optional


def build_platform_health(
    *,
    redis_enabled: bool,
    redis_ping,
    get_snapshot_meta,
    get_maritime_stats,
) -> dict[str, Any]:
    redis_ok = False
    redis_error: Optional[str] = None
    if redis_enabled:
        client = redis_ping()
        if client is None:
            redis_error = "redis client unavailable"
        else:
            try:
                client.ping()
                redis_ok = True
            except Exception as exc:
                redis_error = str(exc)

    maritime_snapshot: dict[str, Any] = {"available": False}
    maritime_worker: dict[str, Any] = {"status": "unknown"}
    try:
        maritime_snapshot = get_snapshot_meta()
        stats = get_maritime_stats()
        maritime_worker = stats.get("worker") if isinstance(stats.get("worker"), dict) else {"status": "unknown"}
        if isinstance(stats.get("redis_snapshot"), dict):
            maritime_snapshot = {**maritime_snapshot, **stats["redis_snapshot"]}
    except Exception as exc:
        maritime_worker = {"status": "error", "last_error": str(exc)}

    worker_status = str(maritime_worker.get("status") or "unknown")
    worker_healthy = worker_status in {"ok", "running", "idle"}
    snapshot_ok = bool(maritime_snapshot.get("available")) and not bool(maritime_snapshot.get("stale"))

    return {
        "api": "ok",
        "redis": {
            "enabled": redis_enabled,
            "ok": redis_ok if redis_enabled else None,
            "error": redis_error,
        },
        "maritime_snapshot": maritime_snapshot,
        "maritime_worker": maritime_worker,
        "status": "ok" if redis_ok and (worker_healthy or snapshot_ok) else "degraded",
    }
