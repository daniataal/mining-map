from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

try:
    import redis
except ImportError:
    redis = None

MARITIME_SNAPSHOT_REDIS_KEY = os.getenv("MARITIME_SNAPSHOT_REDIS_KEY", "maritime:snapshot:global").strip()
MARITIME_SNAPSHOT_REGION_KEY_PREFIX = os.getenv(
    "MARITIME_SNAPSHOT_REGION_KEY_PREFIX",
    "maritime:snapshot:region:",
).strip()
MARITIME_SNAPSHOT_VERSION = 1

_redis_client: Any = None
_redis_init_attempted = False


def _int_env(name: str, fallback: int) -> int:
    try:
        return int(os.getenv(name, str(fallback)))
    except (TypeError, ValueError):
        return fallback


def snapshot_redis_ttl_seconds() -> int:
    """Redis key TTL; MARITIME_SNAPSHOT_TTL_SEC overrides MARITIME_SNAPSHOT_TTL_SECONDS."""
    if os.getenv("MARITIME_SNAPSHOT_TTL_SEC", "").strip():
        return max(30, _int_env("MARITIME_SNAPSHOT_TTL_SEC", 600))
    return max(30, _int_env("MARITIME_SNAPSHOT_TTL_SECONDS", 600))


def _redis_enabled() -> bool:
    return bool(os.getenv("REDIS_HOST", "").strip()) and redis is not None


def _get_redis_client():
    global _redis_client, _redis_init_attempted
    if not _redis_enabled():
        return None
    if _redis_init_attempted:
        return _redis_client
    _redis_init_attempted = True
    try:
        _redis_client = redis.Redis(
            host=os.getenv("REDIS_HOST", "").strip(),
            port=_int_env("REDIS_PORT", 6379),
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        _redis_client.ping()
    except Exception as exc:
        print(f"[maritime-snapshot] Redis unavailable: {exc}")
        _redis_client = None
    return _redis_client


def redis_available() -> bool:
    return _get_redis_client() is not None


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc).isoformat()
        return value.astimezone(timezone.utc).isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def serialize_snapshot(payload: dict[str, Any]) -> str:
    return json.dumps(payload, default=_json_default, separators=(",", ":"))


def deserialize_snapshot(raw: str | None) -> Optional[dict[str, Any]]:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(parsed, dict):
        return None
    if parsed.get("version") != MARITIME_SNAPSHOT_VERSION:
        return None
    return parsed


def _region_key(region_id: str) -> str:
    return f"{MARITIME_SNAPSHOT_REGION_KEY_PREFIX}{region_id}"


def _active_region_ids(rows: list[dict[str, Any]]) -> list[str]:
    try:
        from backend.services.maritime_intel import AISSTREAM_WATCH_REGIONS, _row_in_bbox
    except ImportError:
        from services.maritime_intel import AISSTREAM_WATCH_REGIONS, _row_in_bbox

    active: list[str] = []
    for region in AISSTREAM_WATCH_REGIONS:
        region_id = str(region.get("id") or "").strip()
        bbox = region.get("bbox")
        if not region_id or not isinstance(bbox, tuple) or len(bbox) != 4:
            continue
        if any(_row_in_bbox(row, bbox) for row in rows):
            active.append(region_id)
    return active


def _build_snapshot_payload(
    *,
    rows: list[dict[str, Any]],
    status: Optional[dict[str, Any]],
    feed: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    metadata = (status or {}).get("metadata") if isinstance((status or {}).get("metadata"), dict) else {}
    if isinstance(feed, dict):
        for key in ("geography_mode", "region_labels", "effective_bbox_count", "scope"):
            if feed.get(key) is not None and key not in metadata:
                metadata = dict(metadata)
                metadata[key] = feed.get(key)
    return {
        "version": MARITIME_SNAPSHOT_VERSION,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(rows),
        "regions": _active_region_ids(rows),
        "rows": rows,
        "status": status or {},
        "source": (status or {}).get("source") or (feed or {}).get("source") or "AISStream",
        "metadata": metadata,
    }


def publish_maritime_snapshot(
    rows: list[dict[str, Any]],
    status: Optional[dict[str, Any]] = None,
    *,
    feed: Optional[dict[str, Any]] = None,
) -> bool:
    """Write global and regional vessel snapshots to Redis."""
    client = _get_redis_client()
    if client is None:
        return False

    ttl = snapshot_redis_ttl_seconds()
    global_payload = _build_snapshot_payload(rows=rows, status=status, feed=feed)
    try:
        client.set(MARITIME_SNAPSHOT_REDIS_KEY, serialize_snapshot(global_payload), ex=ttl)
        for region_id in global_payload.get("regions") or []:
            region_rows = [
                row
                for row in rows
                if _row_in_region(row, region_id)
            ]
            if not region_rows:
                continue
            regional_payload = _build_snapshot_payload(rows=region_rows, status=status, feed=feed)
            regional_payload["region_id"] = region_id
            client.set(_region_key(region_id), serialize_snapshot(regional_payload), ex=ttl)
    except Exception as exc:
        print(f"[maritime-snapshot] publish failed: {exc}")
        return False
    return True


def _row_in_region(row: dict[str, Any], region_id: str) -> bool:
    try:
        from backend.services.maritime_intel import AISSTREAM_WATCH_REGIONS, _row_in_bbox
    except ImportError:
        from services.maritime_intel import AISSTREAM_WATCH_REGIONS, _row_in_bbox

    for region in AISSTREAM_WATCH_REGIONS:
        if str(region.get("id") or "") != region_id:
            continue
        bbox = region.get("bbox")
        if isinstance(bbox, tuple) and len(bbox) == 4:
            return _row_in_bbox(row, bbox)
    return False


def get_global_maritime_snapshot() -> Optional[dict[str, Any]]:
    client = _get_redis_client()
    if client is None:
        return None
    try:
        raw = client.get(MARITIME_SNAPSHOT_REDIS_KEY)
    except Exception as exc:
        print(f"[maritime-snapshot] get failed: {exc}")
        return None
    return deserialize_snapshot(raw)


def get_regional_maritime_snapshot(region_id: str) -> Optional[dict[str, Any]]:
    client = _get_redis_client()
    if client is None or not region_id:
        return None
    try:
        raw = client.get(_region_key(region_id.strip()))
    except Exception as exc:
        print(f"[maritime-snapshot] regional get failed: {exc}")
        return None
    return deserialize_snapshot(raw)


def get_snapshot_meta() -> dict[str, Any]:
    """Lightweight Redis snapshot health for stats/debug endpoints."""
    payload = get_global_maritime_snapshot()
    if not payload:
        return {
            "available": False,
            "source": None,
            "redis_key": MARITIME_SNAPSHOT_REDIS_KEY,
            "count": 0,
            "regions": [],
            "updated_at": None,
            "age_seconds": None,
            "stale": True,
        }

    updated_at = payload.get("updated_at")
    age_seconds = _age_seconds(updated_at)
    ttl = snapshot_redis_ttl_seconds()
    return {
        "available": True,
        "source": "redis",
        "redis_key": MARITIME_SNAPSHOT_REDIS_KEY,
        "count": int(payload.get("count") or len(payload.get("rows") or [])),
        "regions": list(payload.get("regions") or []),
        "updated_at": updated_at,
        "age_seconds": age_seconds,
        "stale": age_seconds is None or age_seconds > ttl,
        "ttl_seconds": ttl,
    }


def _age_seconds(updated_at: Any) -> Optional[int]:
    if not updated_at:
        return None
    try:
        if isinstance(updated_at, str):
            parsed = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        elif isinstance(updated_at, datetime):
            parsed = updated_at
        else:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return max(0, int((datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds()))
    except (TypeError, ValueError):
        return None


def publish_maritime_snapshot_from_conn(conn, feed: Optional[dict[str, Any]] = None) -> bool:
    try:
        from backend.services.maritime_intel import fetch_persisted_maritime_rows
    except ImportError:
        from services.maritime_intel import fetch_persisted_maritime_rows

    rows, status = fetch_persisted_maritime_rows(conn)
    return publish_maritime_snapshot(rows, status, feed=feed)
