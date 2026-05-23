"""Eurostat COMEXT-style HS27 EU trade into oil_trade_flows (macro tier)."""

from __future__ import annotations

import json
import os
import re
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

_DIM_REPORTER = frozenset({"geo", "reporter", "rep", "reporter_iso", "geopolitical_entity"})
_DIM_PARTNER = frozenset({"partner", "part", "partner_geo", "partner_country"})
_DIM_TIME = frozenset({"time", "time_period", "period"})
_DIM_PRODUCT = frozenset(
    {"product", "hs", "hs6", "hs4", "sitc", "cpa", "prod", "indic_et", "commodity", "nomenclature"}
)
_DIM_FLOW = frozenset({"flow", "indic", "trade_flow", "indicators"})

_DEFAULT_HS = "2709"
_DEFAULT_HS_DESC = "Petroleum oils, crude (Eurostat macro)"
_VALUE_CAP = 500


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


def _dim_role(dim_id: str) -> str:
    key = dim_id.strip().lower()
    if key in _DIM_REPORTER:
        return "reporter"
    if key in _DIM_PARTNER:
        return "partner"
    if key in _DIM_TIME:
        return "year"
    if key in _DIM_PRODUCT:
        return "hs"
    if key in _DIM_FLOW:
        return "flow"
    return "other"


def _sorted_category_codes(dim_entry: dict[str, Any]) -> list[str]:
    index = ((dim_entry or {}).get("category") or {}).get("index") or {}
    if not index:
        return []
    return [code for code, _ in sorted(index.items(), key=lambda item: item[1])]


def _category_labels(dim_entry: dict[str, Any]) -> dict[str, str]:
    return dict(((dim_entry or {}).get("category") or {}).get("label") or {})


def _coords_from_flat_index(flat: int, sizes: list[int]) -> list[int]:
    coords = [0] * len(sizes)
    for i in range(len(sizes) - 1, -1, -1):
        coords[i] = flat % sizes[i]
        flat //= sizes[i]
    return coords


def _parse_year_code(code: str, label: str | None) -> int | None:
    for candidate in (code, label or ""):
        match = re.search(r"(20\d{2}|19\d{2})", candidate)
        if match:
            return int(match.group(1))
    return None


def _parse_hs_code(code: str, label: str | None) -> str:
    for candidate in (code, label or ""):
        match = re.search(r"\b(\d{4,6})\b", candidate)
        if match:
            return match.group(1)[:6]
    if code and re.fullmatch(r"\d{4,6}", code.strip()):
        return code.strip()[:6]
    return _DEFAULT_HS


def _parse_flow_type(code: str, label: str | None) -> str:
    text = f"{code} {label or ''}".upper()
    if "EXP" in text or text.strip() in {"X", "2"}:
        return "X"
    if "IMP" in text or text.strip() in {"M", "1"}:
        return "M"
    return "M"


def _reporter_iso2(geo_code: str) -> str | None:
    code = geo_code.strip().upper()
    if code.startswith("EU"):
        return "EU"
    if len(code) == 2 and code.isalpha():
        return code
    if len(code) >= 4 and code[:2].isalpha():
        return code[:2]
    return None


def _macro_row(
    *,
    reporter: str,
    reporter_iso2: str | None,
    partner: str,
    hs_code: str,
    hs_description: str,
    flow_type: str,
    year: int | None,
    trade_value_usd: float,
    eurostat_key: str,
    dimensions: dict[str, str],
) -> dict[str, Any]:
    return {
        "reporter": reporter,
        "reporter_iso2": reporter_iso2,
        "partner": partner,
        "hs_code": hs_code,
        "hs_description": hs_description,
        "flow_type": flow_type,
        "year": year or 2023,
        "trade_value_usd": trade_value_usd,
        "data_source": "eurostat",
        "bol_tier": "macro",
        "raw": {"eurostat_key": eurostat_key, "dimensions": dimensions},
    }


def _parse_eurostat_flat(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Fallback when JSON-stat dimensions are missing."""
    out: list[dict[str, Any]] = []
    value = payload.get("value")
    if not isinstance(value, dict):
        return out
    for key, val in list(value.items())[:_VALUE_CAP]:
        if val is None:
            continue
        try:
            num = float(val)
        except (TypeError, ValueError):
            continue
        out.append(
            _macro_row(
                reporter="European Union",
                reporter_iso2="EU",
                partner="Extra-EU",
                hs_code=_DEFAULT_HS,
                hs_description=_DEFAULT_HS_DESC,
                flow_type="M",
                year=2023,
                trade_value_usd=num * 1000,
                eurostat_key=str(key),
                dimensions={},
            )
        )
    return out


def _parse_eurostat_dimensional(payload: dict[str, Any]) -> list[dict[str, Any]]:
    dim_ids: list[str] = payload["id"]
    sizes: list[int] = payload["size"]
    dimensions: dict[str, Any] = payload["dimension"]
    value: dict[str, Any] = payload["value"]

    dim_codes: list[list[str]] = []
    dim_label_maps: list[dict[str, str]] = []
    dim_roles: list[str] = []
    for dim_id in dim_ids:
        entry = dimensions.get(dim_id) or {}
        codes = _sorted_category_codes(entry)
        if not codes:
            return []
        dim_codes.append(codes)
        dim_label_maps.append(_category_labels(entry))
        dim_roles.append(_dim_role(dim_id))

    out: list[dict[str, Any]] = []
    for key, val in list(value.items())[:_VALUE_CAP]:
        if val is None:
            continue
        try:
            num = float(val)
        except (TypeError, ValueError):
            continue
        try:
            flat = int(str(key).split(":")[0])
        except ValueError:
            continue

        coords = _coords_from_flat_index(flat, sizes)
        dim_values: dict[str, str] = {}
        reporter = "European Union"
        reporter_iso2: str | None = "EU"
        partner = "Extra-EU"
        hs_code = _DEFAULT_HS
        hs_description = _DEFAULT_HS_DESC
        flow_type = "M"
        year: int | None = None

        for i, dim_id in enumerate(dim_ids):
            code = dim_codes[i][coords[i]]
            label = dim_label_maps[i].get(code)
            dim_values[dim_id] = code
            role = dim_roles[i]
            if role == "reporter":
                reporter = label or code
                reporter_iso2 = _reporter_iso2(code) or reporter_iso2
            elif role == "partner":
                partner = label or code
            elif role == "year":
                year = _parse_year_code(code, label)
            elif role == "hs":
                hs_code = _parse_hs_code(code, label)
                hs_description = label or f"Eurostat product {hs_code}"
            elif role == "flow":
                flow_type = _parse_flow_type(code, label)

        out.append(
            _macro_row(
                reporter=reporter,
                reporter_iso2=reporter_iso2,
                partner=partner,
                hs_code=hs_code,
                hs_description=hs_description,
                flow_type=flow_type,
                year=year,
                trade_value_usd=num * 1000,
                eurostat_key=str(key),
                dimensions=dim_values,
            )
        )
    return out


def _parse_eurostat_json(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Parse Eurostat JSON-stat into macro flow rows."""
    value = payload.get("value")
    if not isinstance(value, dict) or not value:
        return []

    dim_ids = payload.get("id")
    sizes = payload.get("size")
    dimensions = payload.get("dimension")
    if (
        isinstance(dim_ids, list)
        and isinstance(sizes, list)
        and isinstance(dimensions, dict)
        and len(dim_ids) == len(sizes)
        and len(dim_ids) > 0
    ):
        rows = _parse_eurostat_dimensional(payload)
        if rows:
            return rows

    return _parse_eurostat_flat(payload)


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
