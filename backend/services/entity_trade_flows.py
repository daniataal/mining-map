"""Link license entities to stored UN Comtrade rows in oil_trade_flows."""

from __future__ import annotations

import os
import re
from typing import Any, Optional

# HS chapter 27 petroleum codes synced by comtrade worker
HS27_CODES = ("2709", "2710", "2711")

_COMMODITY_HS: dict[str, str] = {
    "gold": "7108",
    "crude oil": "2709",
    "crude petroleum": "2709",
    "petroleum": "2709",
    "oil": "2709",
    "petroleum products": "2710",
    "refined petroleum": "2710",
    "natural gas": "2711",
    "lng": "2711",
    "lpg": "2711",
}


def _resolve_hs(commodity: str) -> Optional[str]:
    key = (commodity or "").strip().lower()
    if not key:
        return None
    if key in _COMMODITY_HS:
        return _COMMODITY_HS[key]
    for token, hs in _COMMODITY_HS.items():
        if token in key or key in token:
            return hs
    return None


def _hs_codes_for_entity(commodity: str) -> list[str]:
    hs = _resolve_hs(commodity)
    if hs and hs.startswith("27"):
        return [hs]
    if hs:
        return [hs]
    # Oil/gas licenses without explicit commodity still get chapter 27 bundle
    commodity_l = (commodity or "").lower()
    if any(tok in commodity_l for tok in ("oil", "petroleum", "gas", "lng", "lpg", "crude")):
        return list(HS27_CODES)
    return []


def _load_license_row(conn: Any, entity_id: str) -> Optional[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, company, country, commodity, license_type, status FROM licenses WHERE id = %s",
            (entity_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    if isinstance(row, dict):
        return row
    return {
        "id": row[0],
        "company": row[1],
        "country": row[2],
        "commodity": row[3],
        "license_type": row[4],
        "status": row[5],
    }


def _parse_year_from_period(period: str | None) -> int | None:
    if not period:
        return None
    match = re.search(r"(20\d{2}|19\d{2})", str(period))
    return int(match.group(1)) if match else None


def _jodi_rows_to_flow_dicts(rows: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows or []:
        if isinstance(row, dict):
            country = row.get("country")
            product = row.get("product")
            indicator = row.get("flow_indicator")
            period = row.get("period")
            value = row.get("value")
        else:
            country, product, indicator, period, value = row[0], row[1], row[2], row[3], row[4]
        out.append(
            _enrich_flow_item(
                {
                    "reporter": country,
                    "partner": indicator or "JODI aggregate",
                    "hs_code": "2709",
                    "hs_description": product or "JODI oil supply/demand",
                    "flow_type": "M",
                    "year": _parse_year_from_period(period) or 0,
                    "trade_value_usd": float(value) if value is not None else None,
                    "data_source": "jodi",
                }
            )
        )
    return out


def _table_exists(cur: Any, name: str) -> bool:
    cur.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = %s",
        (name,),
    )
    return cur.fetchone() is not None


def _column_exists(cur: Any, table: str, column: str) -> bool:
    cur.execute(
        """
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
        """,
        (table, column),
    )
    return cur.fetchone() is not None


def _macro_source_record_url(data_source: str | None) -> str | None:
    ds = (data_source or "").strip().lower()
    if ds == "eurostat":
        code = os.getenv("EUROSTAT_DATASET", "EXT_LT_INTRATRD").strip()
        return f"https://ec.europa.eu/eurostat/databrowser/view/{code}?lang=en"
    if ds in {"census_api", "usitc_dataweb"}:
        return "https://api.census.gov/data/key_signup.html" if ds == "census_api" else "https://dataweb.usitc.gov/"
    if "comtrade" in ds:
        return "https://comtradeplus.un.org/"
    if ds == "jodi":
        return "https://www.jodidata.org/"
    return None


def _enrich_flow_item(item: dict[str, Any]) -> dict[str, Any]:
    item["bol_tier"] = item.get("bol_tier") or "macro"
    item["source_record_url"] = item.get("source_record_url") or _macro_source_record_url(
        item.get("data_source")
    )
    return item


def query_stored_trade_flows(
    conn: Any,
    *,
    country: str,
    hs_codes: list[str],
    limit: int = 50,
) -> list[dict[str, Any]]:
    if not country or not hs_codes:
        return []
    country_l = country.strip().lower()
    out: list[dict[str, Any]] = []
    with conn.cursor() as cur:
        include_raw = _column_exists(cur, "oil_trade_flows", "raw")
        raw_col = ", raw" if include_raw else ""
        cur.execute(
            f"""
            SELECT id, reporter, reporter_iso2, partner, hs_code, hs_description,
                   flow_type, year, trade_value_usd, net_weight_kg, data_source, ingested_at{raw_col}
            FROM oil_trade_flows
            WHERE hs_code = ANY(%s)
              AND (
                LOWER(reporter) LIKE %s
                OR (
                  data_source = 'eurostat'
                  AND LOWER(partner) LIKE %s
                )
              )
            ORDER BY year DESC, trade_value_usd DESC NULLS LAST
            LIMIT %s
            """,
            (list(hs_codes), f"%{country_l}%", f"%{country_l}%", limit),
        )
        rows = cur.fetchall()
        out.extend(_rows_to_flow_dicts(rows, include_raw=include_raw))

        if _table_exists(cur, "commodity_trade_flows"):
            cur.execute(
                """
                SELECT id, reporter, reporter_iso2, partner, hs_code, hs_description,
                       flow_type, year, trade_value_usd, net_weight_kg, data_source, ingested_at,
                       'commodity_trade_flows' AS _table
                FROM commodity_trade_flows
                WHERE (LOWER(reporter) LIKE %s OR LOWER(reporter_iso2) LIKE %s)
                  AND hs_code = ANY(%s)
                ORDER BY year DESC, trade_value_usd DESC NULLS LAST
                LIMIT %s
                """,
                (f"%{country_l}%", f"%{country_l[:2]}%", list(hs_codes), limit),
            )
            rows2 = cur.fetchall()
            out.extend(_rows_to_flow_dicts(rows2, include_raw=False))

        if _table_exists(cur, "jodi_oil_snapshots"):
            cur.execute(
                """
                SELECT country, product, flow_indicator, period, value, unit, data_source, ingested_at
                FROM jodi_oil_snapshots
                WHERE LOWER(country) LIKE %s
                ORDER BY period DESC NULLS LAST
                LIMIT %s
                """,
                (f"%{country_l}%", limit),
            )
            out.extend(_jodi_rows_to_flow_dicts(cur.fetchall()))
    out.sort(key=lambda r: (r.get("year") or 0, r.get("trade_value_usd") or 0), reverse=True)
    return out[:limit]


def _rows_to_flow_dicts(rows: Any, *, include_raw: bool = False) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows or []:
        if isinstance(row, dict):
            item = dict(row)
        else:
            item = {
                "id": row[0],
                "reporter": row[1],
                "reporter_iso2": row[2],
                "partner": row[3],
                "hs_code": row[4],
                "hs_description": row[5],
                "flow_type": row[6],
                "year": row[7],
                "trade_value_usd": row[8],
                "net_weight_kg": row[9],
                "data_source": row[10],
                "ingested_at": row[11].isoformat() if hasattr(row[11], "isoformat") else row[11],
            }
            if include_raw and len(row) > 12:
                raw = row[12]
                if raw is not None and not isinstance(raw, dict):
                    raw = None
                item["raw"] = raw
        out.append(_enrich_flow_item(item))
    return out


def collect_entity_trade_flows(
    conn: Any,
    entity_id: str,
    *,
    entity_kind: str = "license",
    limit: int = 50,
) -> dict[str, Any]:
    if (entity_kind or "").strip().lower() != "license":
        return {
            "entityId": entity_id,
            "entityKind": entity_kind,
            "flows": [],
            "warnings": [f"Trade-flow linkage supports license entities only (got {entity_kind})."],
        }

    license_row = _load_license_row(conn, entity_id)
    if not license_row:
        return {
            "entityId": entity_id,
            "entityKind": "license",
            "flows": [],
            "warnings": ["License not found."],
        }

    country = (license_row.get("country") or "").strip()
    commodity = (license_row.get("commodity") or "").strip()
    hs_codes = _hs_codes_for_entity(commodity)
    if not hs_codes:
        return {
            "entityId": entity_id,
            "entityKind": "license",
            "company": license_row.get("company"),
            "country": country,
            "commodity": commodity,
            "hs_codes": [],
            "flows": [],
            "warnings": [
                "No HS mapping for this commodity — Comtrade linkage applies to petroleum (HS27) "
                "and mapped mining commodities in oil_trade_flows."
            ],
        }

    flows = query_stored_trade_flows(conn, country=country, hs_codes=hs_codes, limit=limit)
    return {
        "entityId": entity_id,
        "entityKind": "license",
        "company": license_row.get("company"),
        "country": country,
        "commodity": commodity,
        "hs_codes": hs_codes,
        "flows": flows,
        "flow_count": len(flows),
        "bol_tier": "macro",
        "provenance": "oil_trade_flows + commodity_trade_flows + jodi_oil_snapshots (macro tier)",
        "limitations": [
            "Country-level bilateral flows — not company-specific customs data.",
            "Rows match license country against reporter (fuzzy), Eurostat partner, or JODI country.",
        ],
        "warnings": [] if flows else ["No macro trade rows for this country/HS — run graph-sync."],
        "sync_cta": "POST /api/admin/oil-live/graph-sync",
    }


def _flow_for_api(flow: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in flow.items() if k != "source_record_url"}
    url = flow.get("source_record_url")
    if url:
        out["sourceRecordUrl"] = url
    return out


def serialize_entity_trade_flows_response(payload: dict[str, Any]) -> dict[str, Any]:
    """CamelCase keys for frontend."""
    flows = [_flow_for_api(f) for f in (payload.get("flows") or [])]
    return {
        "entityId": payload.get("entityId"),
        "entityKind": payload.get("entityKind"),
        "company": payload.get("company"),
        "country": payload.get("country"),
        "commodity": payload.get("commodity"),
        "hsCodes": payload.get("hs_codes") or [],
        "flows": flows,
        "flowCount": payload.get("flow_count", len(payload.get("flows") or [])),
        "provenance": payload.get("provenance"),
        "limitations": payload.get("limitations") or [],
        "warnings": payload.get("warnings") or [],
        "bolTier": payload.get("bol_tier") or "macro",
        "syncCta": payload.get("sync_cta"),
    }
