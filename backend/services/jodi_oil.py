"""JODI oil supply/demand snapshots for corridor validation (macro tier)."""

from __future__ import annotations

import csv
import io
import json
import os
import urllib.request
from typing import Any

JODI_ENABLED = (os.getenv("JODI_SYNC_ENABLED") or "true").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}

# Optional: path or URL to JODI World CSV export (user-provided, no scraping behind login)
JODI_CSV_URL = (os.getenv("JODI_CSV_URL") or "").strip()
JODI_CSV_PATH = (os.getenv("JODI_CSV_PATH") or "").strip()


def _record_jodi_sync(conn: Any, step: dict[str, Any]) -> None:
    if conn is None:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO oil_live_sync_state (key, value, metadata, updated_at)
                VALUES ('last_jodi_sync', now(), %s::jsonb, now())
                ON CONFLICT (key) DO UPDATE SET
                  value = now(),
                  metadata = EXCLUDED.metadata,
                  updated_at = now()
                """,
                (json.dumps(step),),
            )
    except Exception:
        pass


def ensure_jodi_table(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS jodi_oil_snapshots (
                id SERIAL PRIMARY KEY,
                country TEXT NOT NULL,
                product TEXT,
                flow_indicator TEXT,
                period TEXT NOT NULL,
                value NUMERIC,
                unit TEXT,
                data_source TEXT NOT NULL DEFAULT 'jodi',
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX IF NOT EXISTS uq_jodi_snapshot
                ON jodi_oil_snapshots (country, product, flow_indicator, period);
            """
        )


def sync_jodi_snapshots(conn: Any) -> dict[str, Any]:
    if not JODI_ENABLED:
        result = {"status": "skipped", "reason": "JODI_SYNC_ENABLED is off"}
        _record_jodi_sync(conn, result)
        return result

    ensure_jodi_table(conn)
    text = _load_csv_text()
    if not text:
        result = {
            "status": "skipped",
            "reason": "set JODI_CSV_URL or JODI_CSV_PATH to a public JODI export",
        }
        _record_jodi_sync(conn, result)
        return result

    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        result = {"status": "skipped", "rows": 0}
        _record_jodi_sync(conn, result)
        return result

    upserted = 0
    with conn.cursor() as cur:
        for row in rows[:5000]:
            country = (row.get("Country") or row.get("country") or "").strip()
            period = (row.get("Time") or row.get("period") or row.get("TIME_PERIOD") or "").strip()
            product = (row.get("Product") or row.get("product") or "").strip() or None
            indicator = (row.get("Flow") or row.get("flow_indicator") or "").strip() or None
            val_raw = row.get("Value") or row.get("value") or row.get("OBS_VALUE")
            try:
                val = float(val_raw) if val_raw not in (None, "", ".") else None
            except (TypeError, ValueError):
                val = None
            if not country or not period:
                continue
            cur.execute(
                """
                INSERT INTO jodi_oil_snapshots (country, product, flow_indicator, period, value, unit)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (country, product, flow_indicator, period)
                DO UPDATE SET value = EXCLUDED.value, ingested_at = now();
                """,
                (country, product, indicator, period, val, row.get("Unit") or row.get("unit")),
            )
            upserted += 1
    result = {"status": "ok", "rows_upserted": upserted, "data_source": "jodi"}
    _record_jodi_sync(conn, result)
    return result


def _load_csv_text() -> str:
    if JODI_CSV_PATH and os.path.isfile(JODI_CSV_PATH):
        with open(JODI_CSV_PATH, encoding="utf-8", errors="replace") as f:
            return f.read()
    if JODI_CSV_URL:
        try:
            with urllib.request.urlopen(JODI_CSV_URL, timeout=120) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception:
            return ""
    return ""
