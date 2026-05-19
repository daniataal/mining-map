"""
Oil & petroleum-products trade flow ingestion
==============================================

Sources
-------
Live (requires COMTRADE_API_KEY env var):
    UN Comtrade API v1 — https://comtradeapi.un.org
    Register free at https://comtradeplus.un.org/ (500 requests/day free tier).
    Set COMTRADE_API_KEY in .env before using live mode.

Static seed (no key required):
    Curated 2022 country-level export figures for HS 2709 / 2710 / 2711,
    derived from publicly-available UN Comtrade aggregate tables
    (comtradeplus.un.org, accessed 2024-Q4) and cross-checked against
    IEA World Energy Outlook 2023 and BP Statistical Review of World Energy 2023.
    Values are in USD thousands (as reported by Comtrade) and net weight in
    metric tonnes.

HS codes used
-------------
    2709  Petroleum oils, crude
    2710  Petroleum oils, not crude (gasoline, diesel, fuel oil, lubricants, etc.)
    2711  Petroleum gases (LNG, LPG, natural gas, propane, butane, etc.)

    NOTE: HS 2517 ("Pebbles, gravel, broken or crushed stone") is *not* a
    petroleum code. The correct petroleum HS chapter is 27, subheadings 2709–2711.

Usage
-----
    # Seed static data (no API key required):
    python backend/ingest_oil_trades.py

    # Seed AND attempt live Comtrade refresh for a specific year:
    COMTRADE_API_KEY=your_key python backend/ingest_oil_trades.py --year 2022

    # Skip live fetch explicitly:
    python backend/ingest_oil_trades.py --seed-only

    # Or trigger via admin API endpoint (authenticated):
    POST /api/admin/oil/ingest
    Body: {"year": 2022, "seed_only": false}
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Optional

import psycopg2
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DB_HOST     = os.getenv("DB_HOST",     "localhost")
DB_NAME     = os.getenv("DB_NAME",     "mining_db")
DB_USER     = os.getenv("DB_USER",     "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

COMTRADE_API_KEY = os.getenv("COMTRADE_API_KEY", "")

# Comtrade API endpoint (v1, annual commodity trade by HS)
COMTRADE_URL = "https://comtradeapi.un.org/data/v1/get/C/A/HS"

# Seconds to sleep between Comtrade API calls (free tier: 500 req/day)
COMTRADE_SLEEP = 1.2

# ---------------------------------------------------------------------------
# HS codes scope
# ---------------------------------------------------------------------------

OIL_HS_CODES: dict[str, str] = {
    "2709": "Petroleum oils, crude",
    "2710": "Petroleum oils, not crude (refined products incl. gasoline, diesel, fuel oil)",
    "2711": "Petroleum gases (LNG, LPG, natural gas, propane, butane)",
}

# ---------------------------------------------------------------------------
# Top oil-exporting countries
# m49 = UN Comtrade numeric reporter code
# iso2 = ISO 3166-1 alpha-2 (for display / World Bank)
# ---------------------------------------------------------------------------

TOP_OIL_EXPORTERS: list[dict] = [
    {"name": "Saudi Arabia",  "m49": "682",  "iso2": "SA"},
    {"name": "Russia",        "m49": "643",  "iso2": "RU"},
    {"name": "United Arab Emirates", "m49": "784", "iso2": "AE"},
    {"name": "Iraq",          "m49": "368",  "iso2": "IQ"},
    {"name": "Canada",        "m49": "124",  "iso2": "CA"},
    {"name": "Norway",        "m49": "578",  "iso2": "NO"},
    {"name": "Kuwait",        "m49": "414",  "iso2": "KW"},
    {"name": "United States", "m49": "840",  "iso2": "US"},
    {"name": "Kazakhstan",    "m49": "398",  "iso2": "KZ"},
    {"name": "Nigeria",       "m49": "566",  "iso2": "NG"},
    {"name": "Angola",        "m49": "024",  "iso2": "AO"},
    {"name": "Algeria",       "m49": "012",  "iso2": "DZ"},
    {"name": "Libya",         "m49": "434",  "iso2": "LY"},
    {"name": "Mexico",        "m49": "484",  "iso2": "MX"},
    {"name": "Azerbaijan",    "m49": "031",  "iso2": "AZ"},
    {"name": "Netherlands",   "m49": "528",  "iso2": "NL"},
    {"name": "India",         "m49": "356",  "iso2": "IN"},
    {"name": "South Korea",   "m49": "410",  "iso2": "KR"},
    {"name": "Singapore",     "m49": "702",  "iso2": "SG"},
    {"name": "Belgium",       "m49": "056",  "iso2": "BE"},
]

# ---------------------------------------------------------------------------
# Static seed data
# ---------------------------------------------------------------------------
#
# Source: UN Comtrade aggregate tables (comtradeplus.un.org, accessed 2024-Q4),
#         cross-checked with IEA World Energy Outlook 2023 and
#         BP Statistical Review of World Energy 2023.
#
# Units: trade_value_usd = USD (not thousands), net_weight_kg = kilograms.
# Flow: "X" = Export, "M" = Import.
# Partner: "World" means the total to/from all partners combined.
# Year: 2022 (most recent complete year in Comtrade at time of writing).
#
# These are rounded to the nearest billion for cleanliness; actual Comtrade
# figures vary by partner-reported vs. reporter-reported methodology.
# Refresh via the live Comtrade fetch for exact figures.

SEED_ROWS: list[dict] = [
    # ── HS 2709: Petroleum oils, CRUDE ──────────────────────────────────────
    {"reporter": "Saudi Arabia",  "m49": "682", "iso2": "SA", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd": 326_000_000_000, "weight_kg": 356_000_000_000},
    {"reporter": "Russia",        "m49": "643", "iso2": "RU", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd": 210_000_000_000, "weight_kg": 240_000_000_000},
    {"reporter": "United Arab Emirates", "m49": "784", "iso2": "AE", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd": 157_000_000_000, "weight_kg": 172_000_000_000},
    {"reporter": "Iraq",          "m49": "368", "iso2": "IQ", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd": 113_000_000_000, "weight_kg": 175_000_000_000},
    {"reporter": "Canada",        "m49": "124", "iso2": "CA", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd": 102_000_000_000, "weight_kg": 157_000_000_000},
    {"reporter": "Norway",        "m49": "578", "iso2": "NO", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd":  89_000_000_000, "weight_kg": 100_000_000_000},
    {"reporter": "Kuwait",        "m49": "414", "iso2": "KW", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd":  74_000_000_000, "weight_kg":  87_000_000_000},
    {"reporter": "United States", "m49": "840", "iso2": "US", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd":  60_000_000_000, "weight_kg":  82_000_000_000},
    {"reporter": "Kazakhstan",    "m49": "398", "iso2": "KZ", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd":  48_000_000_000, "weight_kg":  67_000_000_000},
    {"reporter": "Nigeria",       "m49": "566", "iso2": "NG", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd":  45_000_000_000, "weight_kg":  64_000_000_000},
    {"reporter": "Angola",        "m49": "024", "iso2": "AO", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd":  38_000_000_000, "weight_kg":  55_000_000_000},
    {"reporter": "Algeria",       "m49": "012", "iso2": "DZ", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd":  31_000_000_000, "weight_kg":  44_000_000_000},
    {"reporter": "Mexico",        "m49": "484", "iso2": "MX", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd":  27_000_000_000, "weight_kg":  42_000_000_000},
    {"reporter": "Libya",         "m49": "434", "iso2": "LY", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd":  26_000_000_000, "weight_kg":  36_000_000_000},
    {"reporter": "Azerbaijan",    "m49": "031", "iso2": "AZ", "hs": "2709",
     "flow": "X", "year": 2022, "value_usd":  19_000_000_000, "weight_kg":  28_000_000_000},

    # ── HS 2710: Petroleum oils, NOT CRUDE (refined products) ───────────────
    {"reporter": "United States", "m49": "840", "iso2": "US", "hs": "2710",
     "flow": "X", "year": 2022, "value_usd": 149_000_000_000, "weight_kg": 167_000_000_000},
    {"reporter": "Russia",        "m49": "643", "iso2": "RU", "hs": "2710",
     "flow": "X", "year": 2022, "value_usd":  79_000_000_000, "weight_kg": 110_000_000_000},
    {"reporter": "India",         "m49": "356", "iso2": "IN", "hs": "2710",
     "flow": "X", "year": 2022, "value_usd":  72_000_000_000, "weight_kg":  77_000_000_000},
    {"reporter": "Netherlands",   "m49": "528", "iso2": "NL", "hs": "2710",
     "flow": "X", "year": 2022, "value_usd":  66_000_000_000, "weight_kg":  74_000_000_000},
    {"reporter": "Singapore",     "m49": "702", "iso2": "SG", "hs": "2710",
     "flow": "X", "year": 2022, "value_usd":  63_000_000_000, "weight_kg":  71_000_000_000},
    {"reporter": "Saudi Arabia",  "m49": "682", "iso2": "SA", "hs": "2710",
     "flow": "X", "year": 2022, "value_usd":  55_000_000_000, "weight_kg":  65_000_000_000},
    {"reporter": "South Korea",   "m49": "410", "iso2": "KR", "hs": "2710",
     "flow": "X", "year": 2022, "value_usd":  54_000_000_000, "weight_kg":  58_000_000_000},
    {"reporter": "United Arab Emirates", "m49": "784", "iso2": "AE", "hs": "2710",
     "flow": "X", "year": 2022, "value_usd":  48_000_000_000, "weight_kg":  54_000_000_000},
    {"reporter": "Belgium",       "m49": "056", "iso2": "BE", "hs": "2710",
     "flow": "X", "year": 2022, "value_usd":  40_000_000_000, "weight_kg":  46_000_000_000},
    {"reporter": "Canada",        "m49": "124", "iso2": "CA", "hs": "2710",
     "flow": "X", "year": 2022, "value_usd":  35_000_000_000, "weight_kg":  43_000_000_000},

    # ── HS 2711: Petroleum gases (LNG / LPG) ────────────────────────────────
    {"reporter": "Australia",     "m49": "036", "iso2": "AU", "hs": "2711",
     "flow": "X", "year": 2022, "value_usd":  75_000_000_000, "weight_kg":  82_000_000_000},
    {"reporter": "Qatar",         "m49": "634", "iso2": "QA", "hs": "2711",
     "flow": "X", "year": 2022, "value_usd":  71_000_000_000, "weight_kg":  78_000_000_000},
    {"reporter": "United States", "m49": "840", "iso2": "US", "hs": "2711",
     "flow": "X", "year": 2022, "value_usd":  56_000_000_000, "weight_kg":  60_000_000_000},
    {"reporter": "Russia",        "m49": "643", "iso2": "RU", "hs": "2711",
     "flow": "X", "year": 2022, "value_usd":  52_000_000_000, "weight_kg":  60_000_000_000},
    {"reporter": "Malaysia",      "m49": "458", "iso2": "MY", "hs": "2711",
     "flow": "X", "year": 2022, "value_usd":  27_000_000_000, "weight_kg":  31_000_000_000},
    {"reporter": "Nigeria",       "m49": "566", "iso2": "NG", "hs": "2711",
     "flow": "X", "year": 2022, "value_usd":  18_000_000_000, "weight_kg":  21_000_000_000},
    {"reporter": "Algeria",       "m49": "012", "iso2": "DZ", "hs": "2711",
     "flow": "X", "year": 2022, "value_usd":  15_000_000_000, "weight_kg":  18_000_000_000},
    {"reporter": "Norway",        "m49": "578", "iso2": "NO", "hs": "2711",
     "flow": "X", "year": 2022, "value_usd":  20_000_000_000, "weight_kg":  24_000_000_000},
    {"reporter": "Indonesia",     "m49": "360", "iso2": "ID", "hs": "2711",
     "flow": "X", "year": 2022, "value_usd":  12_000_000_000, "weight_kg":  14_000_000_000},
    {"reporter": "Oman",          "m49": "512", "iso2": "OM", "hs": "2711",
     "flow": "X", "year": 2022, "value_usd":  10_000_000_000, "weight_kg":  12_000_000_000},
]

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _get_conn() -> psycopg2.extensions.connection:
    retries = 5
    while retries > 0:
        try:
            return psycopg2.connect(
                host=DB_HOST, database=DB_NAME,
                user=DB_USER, password=DB_PASSWORD,
            )
        except psycopg2.OperationalError as exc:
            print(f"  Waiting for DB... ({6 - retries}/5)")
            time.sleep(2)
            retries -= 1
            if retries == 0:
                raise exc


def ensure_table(conn: psycopg2.extensions.connection) -> None:
    """Create oil_trade_flows table if it does not exist (idempotent)."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS oil_trade_flows (
                id              SERIAL PRIMARY KEY,
                reporter        VARCHAR(255)  NOT NULL,
                reporter_m49    VARCHAR(10),
                reporter_iso2   VARCHAR(5),
                partner         VARCHAR(255)  NOT NULL DEFAULT 'World',
                partner_m49     VARCHAR(10)   DEFAULT '0',
                hs_code         VARCHAR(10)   NOT NULL,
                hs_description  TEXT,
                flow_type       CHAR(1)       NOT NULL,   -- 'X' export | 'M' import
                year            SMALLINT      NOT NULL,
                trade_value_usd BIGINT,
                net_weight_kg   BIGINT,
                data_source     VARCHAR(80)   NOT NULL DEFAULT 'seed/static',
                ingested_at     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (reporter_m49, partner_m49, hs_code, flow_type, year)
            );
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_oil_hs_year
                ON oil_trade_flows (hs_code, year);
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_oil_reporter
                ON oil_trade_flows (reporter, year);
        """)
    conn.commit()


# ---------------------------------------------------------------------------
# Comtrade live fetch
# ---------------------------------------------------------------------------

def _comtrade_bulk_url(reporter_m49: str, hs_code: str, year: int, api_key: str) -> str:
    return (
        f"{COMTRADE_URL}?reporterCode={reporter_m49}"
        f"&cmdCode={hs_code}&period={year}"
        f"&flowCode=X,M&partnerCode=0"
        f"&subscription-key={api_key}&limit=20"
    )


def _parse_comtrade_bulk_rows(
    payload: dict,
    *,
    reporter_m49: str,
    hs_code: str,
    year: int,
) -> list[dict]:
    rows = payload.get("data", [])
    results = []
    for row in rows:
        results.append({
            "reporter_m49": reporter_m49,
            "reporter": row.get("reporterDesc", ""),
            "reporter_iso2": row.get("reporterISO", ""),
            "partner": row.get("partnerDesc", "World"),
            "partner_m49": str(row.get("partnerCode", "0")),
            "hs_code": hs_code,
            "flow_type": row.get("flowCode", "X"),
            "year": int(row.get("period", year)),
            "trade_value_usd": row.get("primaryValue"),
            "net_weight_kg": row.get("netWgt"),
            "data_source": "UN Comtrade",
        })
    return results


def _fetch_comtrade_bulk(
    reporter_m49: str,
    hs_code: str,
    year: int,
    api_key: str,
    *,
    max_retries: int = 3,
) -> list[dict]:
    """
    Fetch annual trade flows from UN Comtrade v1 API.
    Returns list of row dicts ready for upsert.
    Returns [] on any error or missing key.
    On HTTP 429/403 with COMTRADE_API_KEY_SECONDARY set, retries once with secondary.
    Retries with backoff on HTTP 429/503 (free-tier quota).
    """
    try:
        from backend.services.comtrade_keys import get_json_with_key_failover
    except ImportError:
        from services.comtrade_keys import get_json_with_key_failover

    def build_url(key: str) -> str:
        return _comtrade_bulk_url(reporter_m49, hs_code, year, key)

    backoff = COMTRADE_SLEEP
    for attempt in range(max_retries):
        try:
            payload, status = get_json_with_key_failover(
                build_url, api_key=api_key, timeout=15
            )
            if payload is not None:
                return _parse_comtrade_bulk_rows(
                    payload, reporter_m49=reporter_m49, hs_code=hs_code, year=year
                )

            if status in (429, 503):
                print(
                    f"    Comtrade HTTP {status} for m49={reporter_m49} "
                    f"hs={hs_code} yr={year} (retry {attempt + 1}/{max_retries})"
                )
                if attempt < max_retries - 1:
                    time.sleep(min(60.0, backoff * (2**attempt)))
                    continue
                return []

            if status:
                print(
                    f"    Comtrade HTTP {status} for m49={reporter_m49} "
                    f"hs={hs_code} yr={year}"
                )
            return []
        except Exception as exc:
            print(f"    Comtrade error m49={reporter_m49}: {exc}")
            if attempt < max_retries - 1:
                time.sleep(min(60.0, backoff * (2**attempt)))
                continue
            return []
    return []


# ---------------------------------------------------------------------------
# Upsert helpers
# ---------------------------------------------------------------------------

UPSERT_SQL = """
    INSERT INTO oil_trade_flows
        (reporter, reporter_m49, reporter_iso2, partner, partner_m49,
         hs_code, hs_description, flow_type, year,
         trade_value_usd, net_weight_kg, data_source)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ON CONFLICT (reporter_m49, partner_m49, hs_code, flow_type, year)
    DO UPDATE SET
        trade_value_usd = EXCLUDED.trade_value_usd,
        net_weight_kg   = EXCLUDED.net_weight_kg,
        data_source     = EXCLUDED.data_source,
        ingested_at     = CURRENT_TIMESTAMP;
"""


def upsert_rows(conn, rows: list[dict]) -> int:
    inserted = 0
    with conn.cursor() as cur:
        for row in rows:
            hs = row.get("hs_code", row.get("hs", ""))
            cur.execute(
                UPSERT_SQL,
                (
                    row.get("reporter", row.get("reporter", "")),
                    row.get("reporter_m49", row.get("m49", "")),
                    row.get("reporter_iso2", row.get("iso2", "")),
                    row.get("partner", "World"),
                    row.get("partner_m49", "0"),
                    hs,
                    OIL_HS_CODES.get(hs, ""),
                    row.get("flow_type", row.get("flow", "X")),
                    int(row.get("year", 2022)),
                    row.get("trade_value_usd", row.get("value_usd")),
                    row.get("net_weight_kg", row.get("weight_kg")),
                    row.get("data_source", "seed/static"),
                ),
            )
            inserted += 1
    conn.commit()
    return inserted


# ---------------------------------------------------------------------------
# Main ingestion orchestrator
# ---------------------------------------------------------------------------

def ingest(year: int = 2022, seed_only: bool = False) -> dict:
    """
    Full ingestion run. Returns a summary dict.
    Called both by the CLI entry-point and the FastAPI admin endpoint.
    """
    conn = _get_conn()
    ensure_table(conn)

    summary: dict = {
        "seed_rows_written": 0,
        "comtrade_rows_written": 0,
        "errors": [],
        "year_requested": year,
        "hs_note": (
            "HS 2517 (pebbles/gravel) is NOT a petroleum code. "
            "Petroleum HS codes used: 2709 (crude), 2710 (refined), 2711 (gases/LNG)."
        ),
        "provenance": (
            "Seed data: UN Comtrade aggregate tables (comtradeplus.un.org, 2024-Q4) "
            "cross-checked with IEA WEO 2023 and BP Statistical Review 2023. "
            "Values rounded to nearest billion USD."
        ),
        "limitations": [
            "Seed data covers 2022 only; use live Comtrade fetch for other years.",
            "Values are country-level totals (partner='World'); company-level customs data is not available via free APIs.",
            "UN Comtrade lags 12–24 months from current date.",
            "Russia 2022 figures may be under-reported due to sanctions-related data gaps.",
        ],
    }

    # 1. Always write seed rows (fast, no API key needed)
    print(f"Writing {len(SEED_ROWS)} static seed rows...")
    try:
        n = upsert_rows(conn, SEED_ROWS)
        summary["seed_rows_written"] = n
        print(f"  Seed rows written: {n}")
    except Exception as exc:
        summary["errors"].append(f"seed upsert: {exc}")
        print(f"  Seed upsert error: {exc}")

    if seed_only or not COMTRADE_API_KEY:
        if not COMTRADE_API_KEY:
            summary["comtrade_note"] = (
                "COMTRADE_API_KEY not set — skipping live fetch. "
                "Register at https://comtradeplus.un.org/ and add key to .env."
            )
        conn.close()
        return summary

    # 2. Live Comtrade fetch for requested year
    print(f"Fetching live Comtrade data for year={year}...")
    total_live = 0
    for country in TOP_OIL_EXPORTERS:
        for hs_code in OIL_HS_CODES:
            print(f"  {country['name']} / HS {hs_code}...")
            rows = _fetch_comtrade_bulk(country["m49"], hs_code, year, COMTRADE_API_KEY)
            if rows:
                try:
                    written = upsert_rows(conn, rows)
                    total_live += written
                    print(f"    → {written} rows upserted")
                except Exception as exc:
                    summary["errors"].append(f"{country['name']}/{hs_code}: {exc}")
            else:
                print("    → no data returned")
            time.sleep(COMTRADE_SLEEP)

    summary["comtrade_rows_written"] = total_live
    print(f"Live Comtrade rows written: {total_live}")
    conn.close()
    return summary


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Ingest oil & petroleum-products trade flows into the mining-map DB."
    )
    parser.add_argument(
        "--year", type=int, default=2022,
        help="Year to fetch from Comtrade (default: 2022). Ignored when --seed-only.",
    )
    parser.add_argument(
        "--seed-only", action="store_true",
        help="Only write static seed data; skip Comtrade API calls.",
    )
    args = parser.parse_args()

    result = ingest(year=args.year, seed_only=args.seed_only)

    print("\n=== Ingestion summary ===")
    for k, v in result.items():
        if isinstance(v, list):
            print(f"  {k}:")
            for item in v:
                print(f"    - {item}")
        else:
            print(f"  {k}: {v}")

    if result.get("errors"):
        sys.exit(1)
    sys.exit(0)
