"""
USITC DataWeb API — U.S. HS bilateral flows (macro tier).
==========================================================

Free account: https://dataweb.usitc.gov/
API docs: https://www.usitc.gov/applications/dataweb/api/dataweb_query_api.html

Set ``USITC_DATAWEB_API_KEY`` (Bearer token from DataWeb → API tab).
Rows land in ``oil_trade_flows`` with ``data_source=usitc_dataweb``.
"""

from __future__ import annotations

import copy
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None  # type: ignore

USITC_BASE_URL = "https://datawebws.usitc.gov/dataweb"
USITC_RUN_REPORT = f"{USITC_BASE_URL}/api/v2/report2/runReport"

US_REPORTER = "United States"
US_M49 = "840"
US_ISO2 = "US"

PETROLEUM_HS: dict[str, str] = {
    "2709": "Petroleum oils, crude",
    "2710": "Petroleum oils, not crude (refined products)",
    "2711": "Petroleum gases (LNG, LPG, natural gas, propane, butane)",
}

REQUEST_TIMEOUT = 45
SLEEP_BETWEEN_CALLS = 0.5

# Minimal query skeleton from USITC sample API request.
_BASIC_QUERY: dict[str, Any] = {
    "savedQueryName": "",
    "savedQueryDesc": "",
    "isOwner": True,
    "runMonthly": False,
    "reportOptions": {
        "tradeType": "Import",
        "classificationSystem": "HTS",
    },
    "searchOptions": {
        "MiscGroup": {
            "districts": {
                "aggregation": "Aggregate District",
                "districtGroups": {"userGroups": []},
                "districts": [],
                "districtsExpanded": [{"name": "All Districts", "value": "all"}],
                "districtsSelectType": "all",
            },
            "importPrograms": {
                "aggregation": None,
                "importPrograms": [],
                "programsSelectType": "all",
            },
            "extImportPrograms": {
                "aggregation": "Aggregate CSC",
                "extImportPrograms": [],
                "extImportProgramsExpanded": [],
                "programsSelectType": "all",
            },
            "provisionCodes": {
                "aggregation": "Aggregate RPCODE",
                "provisionCodesSelectType": "all",
                "rateProvisionCodes": [],
                "rateProvisionCodesExpanded": [],
            },
        },
        "commodities": {
            "aggregation": "Aggregate Commodities",
            "codeDisplayFormat": "YES",
            "commodities": [],
            "commoditiesExpanded": [],
            "commoditiesManual": "",
            "commodityGroups": {"systemGroups": [], "userGroups": []},
            "commoditySelectType": "manual",
            "granularity": "2",
            "groupGranularity": None,
            "searchGranularity": None,
        },
        "componentSettings": {
            "dataToReport": ["CONS_FIR_UNIT_QUANT", "CONS_CIF_VALUE"],
            "scale": "1",
            "timeframeSelectType": "fullYears",
            "years": [],
            "startDate": None,
            "endDate": None,
            "startMonth": None,
            "endMonth": None,
            "yearsTimeline": "Annual",
        },
        "countries": {
            "aggregation": "Break Out Countries",
            "countries": [],
            "countriesExpanded": [{"name": "All Countries", "value": "all"}],
            "countriesSelectType": "all",
            "countryGroups": {"systemGroups": [], "userGroups": []},
        },
    },
    "sortingAndDataFormat": {
        "DataSort": {"columnOrder": [], "fullColumnOrder": [], "sortOrder": []},
        "reportCustomizations": {
            "exportCombineTables": False,
            "showAllSubtotal": True,
            "subtotalRecords": "",
            "totalRecords": "20000",
            "exportRawData": False,
        },
    },
}


def _usitc_enabled() -> bool:
    return (os.getenv("USITC_TRADE_SYNC_ENABLED") or "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _default_year() -> int:
    raw = (os.getenv("USITC_TRADE_SYNC_YEAR") or "").strip()
    if raw.isdigit():
        return int(raw)
    return max(2022, datetime.now(timezone.utc).year - 2)


def _registration_hint() -> str:
    return (
        "Register free at https://dataweb.usitc.gov/ → log in → API tab → copy Bearer token "
        "into USITC_DATAWEB_API_KEY"
    )


def build_usitc_report_query(*, hs_code: str, year: int, trade_type: str) -> dict[str, Any]:
    """Build a USITC runReport payload for one HS code and trade direction."""
    query = copy.deepcopy(_BASIC_QUERY)
    query["reportOptions"]["tradeType"] = trade_type
    query["searchOptions"]["commodities"]["commoditiesManual"] = hs_code
    query["searchOptions"]["componentSettings"]["years"] = [str(year)]
    return query


def _column_labels(column_groups: Any) -> list[str]:
    labels: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            if "label" in node and isinstance(node["label"], str):
                labels.append(node["label"])
            for key in ("columns", "column_groups"):
                if key in node:
                    walk(node[key])

    walk(column_groups)
    return labels


def _row_values(rows_new: Any) -> list[list[Any]]:
    out: list[list[Any]] = []
    if not isinstance(rows_new, list):
        return out
    for row in rows_new:
        if not isinstance(row, dict):
            continue
        entries = row.get("rowEntries")
        if not isinstance(entries, list):
            continue
        out.append([entry.get("value") if isinstance(entry, dict) else entry for entry in entries])
    return out


def _pick_column(labels: list[str], patterns: tuple[str, ...]) -> Optional[int]:
    lower = [label.lower() for label in labels]
    for pattern in patterns:
        for idx, label in enumerate(lower):
            if pattern in label:
                return idx
    return None


def _parse_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    text = str(value).replace(",", "").strip()
    if not text or text in {"-", "N/A", "n/a"}:
        return None
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return None


def parse_usitc_report_rows(
    payload: dict[str, Any],
    *,
    hs_code: str,
    year: int,
    trade_type: str,
) -> list[dict[str, Any]]:
    """Parse USITC runReport JSON into oil_trade_flows-shaped rows."""
    dto = payload.get("dto") if isinstance(payload, dict) else None
    tables = dto.get("tables") if isinstance(dto, dict) else None
    if not isinstance(tables, list) or not tables:
        return []

    table0 = tables[0]
    if not isinstance(table0, dict):
        return []

    labels = _column_labels(table0.get("column_groups"))
    row_groups = table0.get("row_groups")
    if not isinstance(row_groups, list) or not row_groups:
        return []
    rows_new = row_groups[0].get("rowsNew") if isinstance(row_groups[0], dict) else None
    matrix = _row_values(rows_new)
    if not labels or not matrix:
        return []

    country_idx = _pick_column(labels, ("country", "partner"))
    hs_idx = _pick_column(labels, ("hts", "commodity", "i_commodity"))
    year_idx = _pick_column(labels, ("year", "time"))
    value_idx = _pick_column(labels, ("customs value", "cif value", "value", "all_val"))
    weight_idx = _pick_column(labels, ("quantity", "weight", "unit quant"))

    flow_type = "M" if trade_type.lower().startswith("import") else "X"
    out: list[dict[str, Any]] = []

    for row in matrix:
        if country_idx is None or country_idx >= len(row):
            continue
        partner = str(row[country_idx] or "").strip()
        if not partner or partner.lower() in {"total", "world", "all countries"}:
            continue
        row_hs = hs_code
        if hs_idx is not None and hs_idx < len(row) and row[hs_idx]:
            row_hs = re.sub(r"[^0-9]", "", str(row[hs_idx]))[:4] or hs_code
        row_year = year
        if year_idx is not None and year_idx < len(row) and row[year_idx]:
            try:
                row_year = int(str(row[year_idx])[:4])
            except ValueError:
                row_year = year
        value_usd = _parse_int(row[value_idx]) if value_idx is not None else None
        weight_kg = _parse_int(row[weight_idx]) if weight_idx is not None else None
        out.append(
            {
                "reporter": US_REPORTER,
                "reporter_m49": US_M49,
                "reporter_iso2": US_ISO2,
                "partner": partner,
                "partner_m49": "",
                "hs_code": row_hs,
                "flow_type": flow_type,
                "year": row_year,
                "trade_value_usd": value_usd,
                "net_weight_kg": weight_kg,
                "data_source": "usitc_dataweb",
            }
        )
    return out


def fetch_usitc_us_flow_rows(
    *,
    year: Optional[int] = None,
    api_key: Optional[str] = None,
    hs_codes: Optional[tuple[str, ...]] = None,
) -> tuple[list[dict[str, Any]], Optional[str]]:
    """
    Pull U.S. bilateral HS flows from USITC DataWeb.
    Returns (rows, error_message).
    """
    if requests is None:
        return [], "requests library unavailable"

    key = (api_key if api_key is not None else os.getenv("USITC_DATAWEB_API_KEY", "")).strip()
    if not key:
        return [], f"USITC_DATAWEB_API_KEY not set — {_registration_hint()}"

    target_year = year if year is not None else _default_year()
    codes = hs_codes or tuple(PETROLEUM_HS.keys())
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": f"Bearer {key}",
    }
    out: list[dict[str, Any]] = []
    last_error: Optional[str] = None

    for hs_code in codes:
        for trade_type in ("Import", "Export"):
            payload = build_usitc_report_query(hs_code=hs_code, year=target_year, trade_type=trade_type)
            try:
                resp = requests.post(
                    USITC_RUN_REPORT,
                    headers=headers,
                    json=payload,
                    timeout=REQUEST_TIMEOUT,
                )
            except Exception as exc:
                last_error = str(exc)
                continue
            if resp.status_code in (401, 403):
                return [], f"USITC auth failed ({resp.status_code}) — {_registration_hint()}"
            if resp.status_code != 200:
                last_error = f"USITC HTTP {resp.status_code}: {resp.text[:200]}"
                continue
            try:
                body = resp.json()
            except ValueError:
                last_error = "USITC returned non-JSON response"
                continue
            if isinstance(body, dict) and body.get("error"):
                last_error = str(body.get("error"))
                continue
            out.extend(
                parse_usitc_report_rows(body, hs_code=hs_code, year=target_year, trade_type=trade_type)
            )
            time.sleep(SLEEP_BETWEEN_CALLS)

    if not out and last_error:
        return [], last_error
    return out, None


def sync_usitc_dataweb_flows(
    conn: Any,
    *,
    year: Optional[int] = None,
    api_key: Optional[str] = None,
) -> dict[str, Any]:
    """Upsert USITC HS27 bilateral rows into oil_trade_flows (macro tier)."""
    if not _usitc_enabled():
        return {"status": "skipped", "reason": "USITC_TRADE_SYNC_ENABLED is off"}

    key = (api_key if api_key is not None else os.getenv("USITC_DATAWEB_API_KEY", "")).strip()
    if not key:
        return {
            "status": "skipped",
            "reason": f"USITC_DATAWEB_API_KEY not set — {_registration_hint()}",
            "tier": "macro",
            "data_source": "usitc_dataweb",
        }

    try:
        from backend.ingest_oil_trades import ensure_table, upsert_rows
    except ImportError:
        from ingest_oil_trades import ensure_table, upsert_rows

    target_year = year if year is not None else _default_year()
    rows, err = fetch_usitc_us_flow_rows(year=target_year, api_key=key)
    if err and not rows:
        return {
            "status": "error",
            "year": target_year,
            "message": err,
            "registration": _registration_hint(),
            "tier": "macro",
            "data_source": "usitc_dataweb",
        }

    ensure_table(conn)
    written = upsert_rows(conn, rows) if rows else 0
    result: dict[str, Any] = {
        "status": "ok" if rows else "ok",
        "year": target_year,
        "rows_upserted": written,
        "tier": "macro",
        "data_source": "usitc_dataweb",
    }
    if err:
        result["warning"] = err
    if not rows:
        result["message"] = "USITC API returned no petroleum HS rows (check year/HS or data load mode)"
    return result
