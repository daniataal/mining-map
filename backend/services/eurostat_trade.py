"""Eurostat COMEXT-style HS27 EU trade into oil_trade_flows (macro tier)."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from typing import Any

EUROSTAT_ENABLED = (os.getenv("EUROSTAT_SYNC_ENABLED") or "true").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}

# EU27 extra-EU imports of crude oil (example dataset; macro aggregates)
_DATASET = os.getenv("EUROSTAT_DATASET", "DS-045409")
_BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"


def _record_eurostat_sync(conn: Any, step: dict[str, Any]) -> None:
    """Persist last Eurostat graph-sync step for oil-live sync-status."""
    if conn is None:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO oil_live_sync_state (key, value, metadata, updated_at)
                VALUES ('last_eurostat_sync', now(), %s::jsonb, now())
                ON CONFLICT (key) DO UPDATE SET
                  value = now(),
                  metadata = EXCLUDED.metadata,
                  updated_at = now()
                """,
                (json.dumps(step),),
            )
    except Exception:
        pass  # table may be absent before oil-live-intel migrations


def sync_eurostat_hs27(conn: Any) -> dict[str, Any]:
    if not EUROSTAT_ENABLED:
        result = {"status": "skipped", "reason": "EUROSTAT_SYNC_ENABLED is off"}
        _record_eurostat_sync(conn, result)
        return result

    url = f"{_BASE}/{_DATASET}?format=JSON&lang=en&lastTimePeriod=3"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=90) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        result = {"status": "skipped", "error": str(exc), "note": "Eurostat API unreachable"}
        _record_eurostat_sync(conn, result)
        return result

    rows = _parse_eurostat_json(payload)
    if not rows:
        result = {"status": "skipped", "rows": 0, "note": "no parseable Eurostat rows"}
        _record_eurostat_sync(conn, result)
        return result

    upserted = _upsert_oil_trade_flows(conn, rows)
    result = {"status": "ok", "rows_upserted": upserted, "data_source": "eurostat"}
    _record_eurostat_sync(conn, result)
    return result


def _parse_eurostat_json(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Best-effort parse Eurostat JSON-stat into macro flow rows."""
    out: list[dict[str, Any]] = []
    value = payload.get("value")
    if not isinstance(value, dict):
        return out
    # Without full dimension index mapping we store aggregate points only
    for key, val in list(value.items())[:500]:
        if val is None:
            continue
        try:
            num = float(val)
        except (TypeError, ValueError):
            continue
        out.append(
            {
                "reporter": "European Union",
                "reporter_iso2": "EU",
                "partner": "Extra-EU",
                "hs_code": "2709",
                "hs_description": "Petroleum oils, crude (Eurostat aggregate)",
                "flow_type": "M",
                "year": 2023,
                "trade_value_usd": num * 1000,
                "data_source": "eurostat",
                "bol_tier": "macro",
                "raw": {"eurostat_key": key},
            }
        )
    return out


def _upsert_oil_trade_flows(conn: Any, rows: list[dict[str, Any]]) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS oil_trade_flows (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                data_source TEXT,
                reporter TEXT,
                reporter_iso2 TEXT,
                partner TEXT,
                hs_code TEXT,
                hs_description TEXT,
                flow_type TEXT,
                year INT,
                trade_value_usd NUMERIC,
                net_weight_kg NUMERIC,
                raw JSONB,
                ingested_at TIMESTAMPTZ DEFAULT now()
            );
            """
        )
        n = 0
        for row in rows:
            cur.execute(
                """
                INSERT INTO oil_trade_flows (
                    data_source, reporter, reporter_iso2, partner, hs_code, hs_description,
                    flow_type, year, trade_value_usd, raw
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                ON CONFLICT DO NOTHING;
                """,
                (
                    row.get("data_source", "eurostat"),
                    row.get("reporter"),
                    row.get("reporter_iso2"),
                    row.get("partner"),
                    row.get("hs_code"),
                    row.get("hs_description"),
                    row.get("flow_type"),
                    row.get("year"),
                    row.get("trade_value_usd"),
                    json.dumps(row.get("raw") or {}),
                ),
            )
            n += cur.rowcount
    return n
