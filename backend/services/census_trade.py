"""
U.S. Census International Trade API — HS bilateral flows (macro tier).
=====================================================================

Free API key: https://api.census.gov/data/key_signup.html
Set ``CENSUS_API_KEY`` in .env.

Country-level U.S. import/export by partner and HS 2709/2710/2711.
Rows land in ``oil_trade_flows`` with ``data_source=census_api`` (macro, not BOL).
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None  # type: ignore

CENSUS_EXPORTS_URL = "https://api.census.gov/data/timeseries/intltrade/exports/hs"
CENSUS_IMPORTS_URL = "https://api.census.gov/data/timeseries/intltrade/imports/hs"

US_REPORTER = "United States"
US_M49 = "840"
US_ISO2 = "US"

PETROLEUM_HS: dict[str, str] = {
    "2709": "Petroleum oils, crude",
    "2710": "Petroleum oils, not crude (refined products)",
    "2711": "Petroleum gases (LNG, LPG, natural gas, propane, butane)",
}

REQUEST_TIMEOUT = 20
SLEEP_BETWEEN_CALLS = 0.35


def _census_enabled() -> bool:
    return (os.getenv("CENSUS_TRADE_SYNC_ENABLED") or "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _default_year() -> int:
    raw = (os.getenv("CENSUS_TRADE_SYNC_YEAR") or "").strip()
    if raw.isdigit():
        return int(raw)
    return max(2022, datetime.now(timezone.utc).year - 2)


def _fetch_census_table(
    base_url: str,
    *,
    api_key: str,
    hs_code: str,
    year: int,
) -> list[list[Any]]:
    if requests is None:
        return []
    params = {
        "get": "CTY_CODE,CTY_NAME,I_COMMODITY,ALL_VAL_YR,SHIPPING_WEIGHT",
        "time": str(year),
        "I_COMMODITY": hs_code,
        "key": api_key,
    }
    try:
        resp = requests.get(base_url, params=params, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            return []
        data = resp.json()
        if not isinstance(data, list) or len(data) < 2:
            return []
        return data[1:]
    except Exception:
        return []


def fetch_census_us_flow_rows(
    *,
    year: Optional[int] = None,
    api_key: Optional[str] = None,
    hs_codes: Optional[tuple[str, ...]] = None,
) -> list[dict[str, Any]]:
    """
    Pull U.S. bilateral HS flows from Census exports + imports endpoints.
    Returns rows ready for ``ingest_oil_trades.upsert_rows``.
    """
    key = (api_key if api_key is not None else os.getenv("CENSUS_API_KEY", "")).strip()
    if not key:
        return []

    target_year = year if year is not None else _default_year()
    codes = hs_codes or tuple(PETROLEUM_HS.keys())
    out: list[dict[str, Any]] = []

    for hs_code in codes:
        for base_url, flow_type in (
            (CENSUS_EXPORTS_URL, "X"),
            (CENSUS_IMPORTS_URL, "M"),
        ):
            rows = _fetch_census_table(
                base_url, api_key=key, hs_code=hs_code, year=target_year
            )
            time.sleep(SLEEP_BETWEEN_CALLS)
            for row in rows:
                if len(row) < 4:
                    continue
                cty_code, cty_name, commodity, value_raw = row[0], row[1], row[2], row[3]
                if str(commodity) != hs_code:
                    continue
                try:
                    value_usd = int(float(str(value_raw).replace(",", "")))
                except (TypeError, ValueError):
                    value_usd = None
                weight_kg = None
                if len(row) > 4 and row[4] not in (None, ""):
                    try:
                        # Census shipping weight is typically in kg for HS series
                        weight_kg = int(float(str(row[4]).replace(",", "")))
                    except (TypeError, ValueError):
                        weight_kg = None
                partner_m49 = str(cty_code).strip() or "0"
                out.append(
                    {
                        "reporter": US_REPORTER,
                        "reporter_m49": US_M49,
                        "reporter_iso2": US_ISO2,
                        "partner": (str(cty_name).strip() or "Unknown"),
                        "partner_m49": partner_m49,
                        "hs_code": hs_code,
                        "flow_type": flow_type,
                        "year": target_year,
                        "trade_value_usd": value_usd,
                        "net_weight_kg": weight_kg,
                        "data_source": "census_api",
                    }
                )
    return out


def sync_census_trade_flows(
    conn: Any,
    *,
    year: Optional[int] = None,
    api_key: Optional[str] = None,
) -> dict[str, Any]:
    """Upsert Census HS27 bilateral rows into oil_trade_flows (macro tier)."""
    if not _census_enabled():
        return {"status": "skipped", "reason": "CENSUS_TRADE_SYNC_ENABLED is off"}
    key = (api_key if api_key is not None else os.getenv("CENSUS_API_KEY", "")).strip()
    if not key:
        return {
            "status": "skipped",
            "reason": "CENSUS_API_KEY not set — free signup at https://api.census.gov/data/key_signup.html",
        }

    try:
        from backend.ingest_oil_trades import ensure_table, upsert_rows
    except ImportError:
        from ingest_oil_trades import ensure_table, upsert_rows

    target_year = year if year is not None else _default_year()
    ensure_table(conn)
    rows = fetch_census_us_flow_rows(year=target_year, api_key=key)
    if not rows:
        return {
            "status": "ok",
            "year": target_year,
            "rows_upserted": 0,
            "message": "Census API returned no rows (check year/HS or rate limits)",
        }
    written = upsert_rows(conn, rows)
    return {
        "status": "ok",
        "year": target_year,
        "rows_upserted": written,
        "tier": "macro",
        "data_source": "census_api",
    }
