"""Persist license sync drift warnings for admin alerts."""

from __future__ import annotations

import json
import os
import smtplib
import ssl
import urllib.request
from email.message import EmailMessage
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


def mark_alert_read(conn: Any, alert_id: int) -> bool:
    """Mark a single sync alert as read. Returns True when a row was updated."""
    ensure_sync_alert_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sync_alert_events
            SET read_at = NOW()
            WHERE id = %s AND read_at IS NULL
            RETURNING id;
            """,
            (int(alert_id),),
        )
        row = cur.fetchone()
    return row is not None


def mark_all_alerts_read(conn: Any) -> int:
    """Mark all unread sync alerts as read. Returns count updated."""
    ensure_sync_alert_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sync_alert_events
            SET read_at = NOW()
            WHERE read_at IS NULL
            RETURNING id;
            """
        )
        rows = cur.fetchall()
    return len(rows)


def _admin_data_health_path() -> str:
    return (os.getenv("ADMIN_DATA_HEALTH_PATH") or "/admin?tab=data-health").strip()


def _admin_ui_url() -> Optional[str]:
    base = (os.getenv("APP_PUBLIC_URL") or "").strip().rstrip("/")
    if not base:
        return None
    path = _admin_data_health_path()
    if not path.startswith("/"):
        path = f"/{path}"
    return f"{base}{path}"


def _drift_alert_context(
    *,
    run_id: int,
    source_id: Optional[str],
    drift_warning: dict[str, Any],
) -> dict[str, Any]:
    drop_pct = drift_warning.get("drop_pct")
    if drop_pct is None:
        drop_pct = drift_warning.get("pct_drop")
    admin_url = _admin_ui_url()
    return {
        "type": "license_sync_drift",
        "run_id": run_id,
        "source_id": source_id,
        "alert_type": str(drift_warning.get("type") or "records_written_drop"),
        "drop_pct": drop_pct,
        "message": drift_warning.get("message"),
        "drift_warning": drift_warning,
        "admin_ui_path": _admin_data_health_path(),
        "admin_ui_url": admin_url,
    }


def _maybe_notify_webhook(
    *,
    run_id: int,
    source_id: Optional[str],
    drift_warning: dict[str, Any],
) -> None:
    url = (os.getenv("SYNC_ALERT_WEBHOOK_URL") or "").strip()
    if not url:
        return
    body = json.dumps(_drift_alert_context(run_id=run_id, source_id=source_id, drift_warning=drift_warning)).encode(
        "utf-8"
    )
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
    smtp_from = (os.getenv("SMTP_FROM") or "").strip()
    smtp_to_raw = (os.getenv("SMTP_TO") or "").strip()
    if not smtp_host or not smtp_from or not smtp_to_raw:
        return

    recipients = [addr.strip() for addr in smtp_to_raw.split(",") if addr.strip()]
    if not recipients:
        return

    ctx = _drift_alert_context(run_id=run_id, source_id=source_id, drift_warning=drift_warning)
    drop_pct = ctx.get("drop_pct")
    pct_label = f"{drop_pct}%" if drop_pct is not None else "n/a"
    subject = f"[Meridian] Sync drift {source_id or 'unknown'} ({pct_label} drop)"
    admin_line = f"Admin: {ctx['admin_ui_url']}\n" if ctx.get("admin_ui_url") else ""
    body = (
        f"License sync drift detected.\n\n"
        f"source_id: {source_id}\n"
        f"drop_pct: {pct_label}\n"
        f"run_id: {run_id}\n"
        f"message: {drift_warning.get('message')}\n"
        f"{admin_line}"
        f"details: {json.dumps(drift_warning, default=str)}\n"
    )
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = smtp_from
    msg["To"] = ", ".join(recipients)
    msg.set_content(body)

    port = int(os.getenv("SMTP_PORT", "587"))
    use_tls = (os.getenv("SMTP_USE_TLS") or "true").strip().lower() not in {"0", "false", "no"}
    user = (os.getenv("SMTP_USER") or "").strip()
    password = (os.getenv("SMTP_PASSWORD") or "").strip()

    try:
        if use_tls:
            with smtplib.SMTP(smtp_host, port, timeout=30) as smtp:
                smtp.ehlo()
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
                if user and password:
                    smtp.login(user, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(smtp_host, port, timeout=30) as smtp:
                if user and password:
                    smtp.login(user, password)
                smtp.send_message(msg)
        print(f"[sync-alert] drift email sent to {len(recipients)} recipient(s)")
    except Exception as exc:
        print(f"[sync-alert] email send failed: {exc}")


def _user_agent() -> str:
    return os.getenv(
        "OPEN_DATA_SYNC_USER_AGENT",
        "MeridianMiningMap/1.0 (open-data sync alerts; contact admin)",
    )
