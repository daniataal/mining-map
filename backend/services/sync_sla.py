"""Sync SLA helpers for admin data-health (green / yellow / red)."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional


def _sla_hours_green() -> float:
    return max(1.0, float(os.getenv("SYNC_SLA_GREEN_HOURS", "24")))


def _sla_hours_yellow() -> float:
    return max(_sla_hours_green(), float(os.getenv("SYNC_SLA_YELLOW_HOURS", "72")))


def _sla_hours_red() -> float:
    return max(_sla_hours_yellow(), float(os.getenv("SYNC_SLA_RED_HOURS", "168")))


def _to_utc(dt: Any) -> Optional[datetime]:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    return None


def hours_since(dt: Optional[datetime], *, now: Optional[datetime] = None) -> Optional[float]:
    if dt is None:
        return None
    ref = now or datetime.now(timezone.utc)
    return max(0.0, (ref - dt).total_seconds() / 3600.0)


def sla_status_from_hours(hours: Optional[float]) -> str:
    """Return green, yellow, red, or unknown."""
    if hours is None:
        return "unknown"
    if hours <= _sla_hours_green():
        return "green"
    if hours <= _sla_hours_yellow():
        return "yellow"
    if hours <= _sla_hours_red():
        return "red"
    return "red"


def enrich_sync_run_with_sla(run: dict[str, Any], *, now: Optional[datetime] = None) -> dict[str, Any]:
    """Add last_success_at, hours_since_sync, sla_status to a sync run dict."""
    finished = _to_utc(run.get("finished_at"))
    started = _to_utc(run.get("started_at"))
    status = str(run.get("status") or "").lower()
    last_success = finished if status == "success" else None
    if last_success is None and status == "success":
        last_success = started
    ref = last_success or finished or started
    hrs = hours_since(ref, now=now)
    enriched = dict(run)
    enriched["last_success_at"] = last_success.isoformat() if last_success else None
    enriched["hours_since_sync"] = round(hrs, 2) if hrs is not None else None
    enriched["sla_status"] = sla_status_from_hours(hrs) if status == "success" or ref else "unknown"
    if status not in ("success", "partial") and ref:
        enriched["sla_status"] = sla_status_from_hours(hrs)
    elif status == "error":
        enriched["sla_status"] = "red" if hrs is not None and hrs > _sla_hours_yellow() else "yellow"
    enriched["sla_thresholds_hours"] = {
        "green": _sla_hours_green(),
        "yellow": _sla_hours_yellow(),
        "red": _sla_hours_red(),
    }
    return enriched


def build_source_sla_dashboard(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One SLA row per source_id from latest sync runs."""
    now = datetime.now(timezone.utc)
    return [enrich_sync_run_with_sla(run, now=now) for run in runs]
