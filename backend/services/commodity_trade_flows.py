"""Mining/metals HS flows into commodity_trade_flows via UN Comtrade."""

from __future__ import annotations

import json
import os
import time
from typing import Any

MINING_HS_CODES: dict[str, str] = {
    "2601": "Iron ores and concentrates",
    "7108": "Gold",
    "7403": "Copper refined",
    "7404": "Copper waste and scrap",
}

SYNC_ENABLED = (os.getenv("COMMODITY_COMTRADE_SYNC_ENABLED") or "true").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}


def ensure_commodity_trade_flows_table(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS commodity_trade_flows (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                data_source TEXT NOT NULL,
                bol_tier TEXT NOT NULL DEFAULT 'macro',
                reporter TEXT,
                reporter_iso2 TEXT,
                partner TEXT,
                partner_iso2 TEXT,
                hs_code TEXT NOT NULL,
                hs_description TEXT,
                commodity_family TEXT,
                flow_type TEXT,
                year INT,
                trade_value_usd NUMERIC,
                net_weight_kg NUMERIC,
                raw JSONB DEFAULT '{}'::jsonb,
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX IF NOT EXISTS uq_commodity_trade_flows_grain
                ON commodity_trade_flows (data_source, reporter_iso2, partner_iso2, hs_code, year, flow_type);
            """
        )


def sync_mining_hs_comtrade(conn: Any) -> dict[str, Any]:
    if not SYNC_ENABLED:
        return {"status": "skipped", "reason": "COMMODITY_COMTRADE_SYNC_ENABLED is off"}

    key = (os.getenv("COMTRADE_API_KEY") or "").strip()
    if not key:
        return {"status": "skipped", "reason": "COMTRADE_API_KEY not set"}

    try:
        from backend.ingest_oil_trades import _fetch_comtrade_bulk, TOP_OIL_EXPORTERS
    except ImportError:
        from ingest_oil_trades import _fetch_comtrade_bulk, TOP_OIL_EXPORTERS

    ensure_commodity_trade_flows_table(conn)
    year = int(os.getenv("COMMODITY_COMTRADE_YEAR", str(max(2022, time.gmtime().tm_year - 2))))
    reporters = TOP_OIL_EXPORTERS[:12]
    total = 0
    errors: list[str] = []

    with conn.cursor() as cur:
        for hs, desc in MINING_HS_CODES.items():
            family = "gold" if hs.startswith("71") else "copper" if hs.startswith("74") else "iron_ore"
            for rep in reporters:
                try:
                    bulk = _fetch_comtrade_bulk(rep, year, hs, api_key=key)
                    time.sleep(1.2)
                except Exception as exc:
                    errors.append(f"{rep}/{hs}: {exc}")
                    continue
                for row in bulk:
                    cur.execute(
                        """
                        INSERT INTO commodity_trade_flows (
                            data_source, bol_tier, reporter, reporter_iso2, partner, partner_iso2,
                            hs_code, hs_description, commodity_family, flow_type, year,
                            trade_value_usd, net_weight_kg, raw
                        ) VALUES (
                            'comtrade', 'macro', %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                        )
                        ON CONFLICT (data_source, reporter_iso2, partner_iso2, hs_code, year, flow_type)
                        DO UPDATE SET trade_value_usd = EXCLUDED.trade_value_usd,
                            net_weight_kg = EXCLUDED.net_weight_kg,
                            ingested_at = now();
                        """,
                        (
                            row.get("reporter"),
                            row.get("reporter_iso2") or row.get("reporter"),
                            row.get("partner"),
                            row.get("partner_iso2") or row.get("partner"),
                            hs,
                            desc,
                            family,
                            row.get("flow_type") or "X",
                            year,
                            row.get("trade_value_usd"),
                            row.get("net_weight_kg"),
                            json.dumps(row),
                        ),
                    )
                    total += 1

    return {"status": "ok", "rows_upserted": total, "year": year, "errors": errors[:20]}
