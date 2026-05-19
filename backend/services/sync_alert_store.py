"""Persist license sync drift warnings for admin alerts."""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Any, Optional


def ensure_sync_alert_tables(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS sync_alert_events (
                id SERIAL PRIMARY KEY,
                run_id INTEGER,
                source_id TEXT,
                alert_type TEXT NOT NULL DEFAULT 'records_written_drop',
                payload JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                read_at TIMESTAMPTZ
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sync_alert_events_created
            ON sync_alert_events (created_at DESC);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sync_alert_events_unread
            ON sync_alert_events (read_at) WHERE read_at IS NULL;
            """
        )


def record_drift_alert(
    conn: Any,
    *,
    run_id: int,
    source_id: Optional[str],
    drift_warning: dict[str, Any],
) -> int:
    """Insert a drift alert row and optionally notify webhook. Returns alert id."""
    ensure_sync_alert_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sync_alert_events (run_id, source_id, alert_type, payload)
            VALUES (%s, %s, %s, %s::jsonb)
            RETURNING id;
            """,
            (
                run_id,
                source_id,
                str(drift_warning.get("type") or "records_written_drop"),
                json.dumps(drift_warning),
            ),
        )
        row = cur.fetchone()
        alert_id = int(row[0])

    _maybe_notify_webhook(run_id=run_id, source_id=source_id, drift_warning=drift_warning)
    _maybe_notify_email_stub(run_id=run_id, source_id=source_id, drift_warning=drift_warning)
    return alert_id


def count_unread_alerts(conn: Any) -> int:
    ensure_sync_alert_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*)::int FROM sync_alert_events WHERE read_at IS NULL;"
        )
        row = cur.fetchone()
    if not row:
        return 0
    return int(row[0] if not isinstance(row, dict) else row.get("count", 0))


def list_recent_alerts(conn: Any, *, limit: int = 50) -> list[dict[str, Any]]:
    ensure_sync_alert_tables(conn)
    safe_limit = max(1, min(int(limit or 50), 200))
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, run_id, source_id, alert_type, payload, created_at, read_at
            FROM sync_alert_events
            ORDER BY created_at DESC
            LIMIT %s;
            """,
            (safe_limit,),
        )
        rows = cur.fetchall()

    results: list[dict[str, Any]] = []
    for row in rows:
        if isinstance(row, dict):
            item = dict(row)
        else:
            item = {
                "id": row[0],
                "run_id": row[1],
                "source_id": row[2],
                "alert_type": row[3],
                "payload": row[4],
                "created_at": row[5],
                "read_at": row[6],
            }
        payload = item.get("payload")
        if isinstance(payload, str):
            try:
                item["payload"] = json.loads(payload)
            except json.JSONDecodeError:
                pass
        for key in ("created_at", "read_at"):
            val = item.get(key)
            if hasattr(val, "isoformat"):
                item[key] = val.isoformat()
        results.append(item)
    return results


def _maybe_notify_webhook(
    *,
    run_id: int,
    source_id: Optional[str],
    drift_warning: dict[str, Any],
) -> None:
    url = (os.getenv("SYNC_ALERT_WEBHOOK_URL") or "").strip()
    if not url:
        return
    body = json.dumps(
        {
            "type": "license_sync_drift",
            "run_id": run_id,
            "source_id": source_id,
            "drift_warning": drift_warning,
        }
    ).encode("utf-8")
    try:
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": _user_agent()},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10):
            pass
    except Exception as exc:
        print(f"[sync-alert] webhook POST failed: {exc}")


def _maybe_notify_email_stub(
    *,
    run_id: int,
    source_id: Optional[str],
    drift_warning: dict[str, Any],
) -> None:
    smtp_host = (os.getenv("SMTP_HOST") or "").strip()
    if not smtp_host:
        return
    print(
        f"[sync-alert] email stub (SMTP_HOST set): drift on source={source_id!r} "
        f"run_id={run_id} — {drift_warning.get('message')}"
    )


def _user_agent() -> str:
    return os.getenv(
        "OPEN_DATA_SYNC_USER_AGENT",
        "MeridianMiningMap/1.0 (open-data sync alerts; contact admin)",
    )
