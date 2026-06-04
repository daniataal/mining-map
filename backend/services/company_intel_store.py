"""Postgres read path for GET /api/company-intel (no live API on hot path)."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional

try:
    from backend.services.entity_trade_flows import (
        _resolve_hs,
        _table_exists,
        query_stored_trade_flows,
    )
except ImportError:
    from services.entity_trade_flows import (  # type: ignore
        _resolve_hs,
        _table_exists,
        query_stored_trade_flows,
    )

COMPANY_INTEL_LIVE_FALLBACK = (os.getenv("COMPANY_INTEL_LIVE_FALLBACK") or "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
TRADE_STALE_DAYS = int(os.getenv("COMPANY_INTEL_TRADE_STALE_DAYS", "45") or "45")


def company_intel_live_fallback_enabled() -> bool:
    return COMPANY_INTEL_LIVE_FALLBACK


def _flow_type_label(flow_type: str | None) -> str:
    code = (flow_type or "").strip().upper()
    if code == "X":
        return "Export"
    if code == "M":
        return "Import"
    return "Import" if code else "Export"


def _stored_row_to_trade_flow(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "flow": _flow_type_label(row.get("flow_type")),
        "trade_value_usd": row.get("trade_value_usd"),
        "net_weight_kg": row.get("net_weight_kg"),
        "partner": row.get("partner"),
        "year": row.get("year"),
        "qty": None,
        "qty_unit": None,
        "data_source": row.get("data_source"),
        "bol_tier": row.get("bol_tier") or "macro",
    }


def _manifest_row_to_trade_flow(row: dict[str, Any]) -> dict[str, Any]:
    flow_type = (row.get("flow_type") or "").strip().upper()
    return {
        "flow": _flow_type_label(flow_type or "M"),
        "trade_value_usd": row.get("value_usd"),
        "net_weight_kg": None,
        "partner": row.get("partner_country") or row.get("reporter_country"),
        "year": row.get("period_year"),
        "qty": row.get("quantity"),
        "qty_unit": row.get("quantity_unit"),
        "data_source": row.get("data_source") or "trade_manifest_rows",
        "bol_tier": row.get("bol_tier") or "customs_open",
        "company_match": row.get("company_match"),
    }


def _query_trade_manifest_rows(
    conn: Any,
    *,
    company: str,
    country: str,
    hs_code: Optional[str],
    limit: int = 20,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        if not company or not _table_exists(cur, "trade_manifest_rows"):
            return []

    company_l = company.strip().lower()
    country_l = (country or "").strip().lower()
    params: list[Any] = [f"%{company_l}%", f"%{company_l}%"]
    country_clause = ""
    if country_l:
        country_clause = """
            AND (
              LOWER(COALESCE(reporter_country, '')) LIKE %s
              OR LOWER(COALESCE(partner_country, '')) LIKE %s
            )
        """
        params.extend([f"%{country_l}%", f"%{country_l}%"])
    hs_clause = ""
    if hs_code:
        hs_clause = " AND hs_code = %s "
        params.append(hs_code)
    params.append(limit)

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT data_source, bol_tier, reporter_country, partner_country, hs_code,
                   flow_type, period_year, period_month, importer_name, exporter_name,
                   quantity, quantity_unit, value_usd
            FROM trade_manifest_rows
            WHERE (
              LOWER(COALESCE(importer_name, '')) LIKE %s
              OR LOWER(COALESCE(exporter_name, '')) LIKE %s
            )
            {country_clause}
            {hs_clause}
            ORDER BY period_year DESC NULLS LAST, period_month DESC NULLS LAST
            LIMIT %s
            """,
            tuple(params),
        )
        rows = cur.fetchall()

    out: list[dict[str, Any]] = []
    for row in rows or []:
        if isinstance(row, dict):
            item = dict(row)
        else:
            item = {
                "data_source": row[0],
                "bol_tier": row[1],
                "reporter_country": row[2],
                "partner_country": row[3],
                "hs_code": row[4],
                "flow_type": row[5],
                "period_year": row[6],
                "period_month": row[7],
                "importer_name": row[8],
                "exporter_name": row[9],
                "quantity": row[10],
                "quantity_unit": row[11],
                "value_usd": row[12],
            }
        if company_l in (item.get("importer_name") or "").lower():
            item["company_match"] = "importer"
        elif company_l in (item.get("exporter_name") or "").lower():
            item["company_match"] = "exporter"
        out.append(_manifest_row_to_trade_flow(item))
    return out


def _query_eia_historic_imports(
    conn: Any,
    *,
    country: str,
    limit: int = 12,
) -> list[dict[str, Any]]:
    if not country:
        return []
    with conn.cursor() as cur:
        if not _table_exists(cur, "eia_historic_imports"):
            return []

    country_l = country.strip().lower()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT origin_country, period_year, period_month, quantity, quantity_unit, value_usd, data_source
            FROM eia_historic_imports
            WHERE LOWER(COALESCE(importer_name, '')) LIKE %s
               OR LOWER(COALESCE(origin_country, '')) LIKE %s
            ORDER BY period_year DESC NULLS LAST, period_month DESC NULLS LAST
            LIMIT %s
            """,
            (f"%{country_l}%", f"%{country_l}%", limit),
        )
        rows = cur.fetchall()

    out: list[dict[str, Any]] = []
    for row in rows or []:
        if isinstance(row, dict):
            origin = row.get("origin_country")
            year = row.get("period_year")
            qty = row.get("quantity")
            qty_unit = row.get("quantity_unit")
            value_usd = row.get("value_usd")
            data_source = row.get("data_source")
        else:
            origin, year, _month, qty, qty_unit, value_usd, data_source = row
        out.append(
            {
                "flow": "Import",
                "trade_value_usd": value_usd,
                "net_weight_kg": None,
                "partner": origin or "EIA origin",
                "year": year,
                "qty": qty,
                "qty_unit": qty_unit,
                "data_source": data_source or "eia_historic_imports",
                "bol_tier": "macro",
            }
        )
    return out


def _read_sync_state(conn: Any) -> dict[str, Any]:
    last_sync: str | None = None
    stale = True
    with conn.cursor() as cur:
        if _table_exists(cur, "oil_live_sync_state"):
            cur.execute(
                "SELECT value FROM oil_live_sync_state WHERE key = %s LIMIT 1;",
                ("last_graph_sync_at",),
            )
            row = cur.fetchone()
            if row and row[0] is not None:
                val = row[0]
                last_sync = val.isoformat() if hasattr(val, "isoformat") else str(val)
                try:
                    if isinstance(val, str):
                        synced_at = datetime.fromisoformat(val.replace("Z", "+00:00"))
                    else:
                        synced_at = val
                    if synced_at.tzinfo is None:
                        synced_at = synced_at.replace(tzinfo=timezone.utc)
                    age = datetime.now(timezone.utc) - synced_at.astimezone(timezone.utc)
                    stale = age.days >= max(1, TRADE_STALE_DAYS)
                except (TypeError, ValueError):
                    stale = True

        if _table_exists(cur, "comtrade_sync_runs"):
            cur.execute(
                """
                SELECT finished_at FROM comtrade_sync_runs
                WHERE status = 'success' AND finished_at IS NOT NULL
                ORDER BY finished_at DESC
                LIMIT 1;
                """
            )
            row = cur.fetchone()
            if row and row[0] is not None:
                finished = row[0]
                comtrade_at = finished.isoformat() if hasattr(finished, "isoformat") else str(finished)
                if not last_sync or (comtrade_at and comtrade_at > last_sync):
                    last_sync = comtrade_at
    return {"last_sync": last_sync, "stale": stale}


def fetch_company_intel_from_postgres(
    conn: Any,
    *,
    country: str,
    company: str = "",
    commodity: str = "",
    hs_code: Optional[str] = None,
    codes: Optional[dict[str, str]] = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Aggregate macro + manifest rows from Postgres for company-intel."""
    resolved_hs = hs_code or _resolve_hs(commodity)
    hs_codes: list[str] = []
    if resolved_hs:
        hs_codes = [resolved_hs]
    elif commodity:
        commodity_l = commodity.strip().lower()
        if any(tok in commodity_l for tok in ("oil", "petroleum", "gas", "lng", "lpg", "crude")):
            hs_codes = ["2709", "2710", "2711"]

    flows: list[dict[str, Any]] = []
    if country and hs_codes:
        stored = query_stored_trade_flows(conn, country=country, hs_codes=hs_codes, limit=limit)
        flows.extend(_stored_row_to_trade_flow(row) for row in stored)

    if company:
        flows.extend(
            _query_trade_manifest_rows(
                conn,
                company=company,
                country=country,
                hs_code=resolved_hs,
                limit=min(20, limit),
            )
        )

    if resolved_hs == "2709" or (not resolved_hs and country):
        flows.extend(_query_eia_historic_imports(conn, country=country, limit=12))

    flows.sort(
        key=lambda item: (item.get("year") or 0, item.get("trade_value_usd") or 0),
        reverse=True,
    )
    flows = flows[:limit]

    sync_state = _read_sync_state(conn)
    year = max((int(f["year"]) for f in flows if f.get("year")), default=0) or None
    trade_data: dict[str, Any] = {}
    if flows:
        sources = sorted({str(f.get("data_source") or "postgres") for f in flows})
        trade_data = {
            "source": f"Postgres ledger ({', '.join(sources)})",
            "source_key": "postgres",
            "year": year,
            "hs_code": resolved_hs,
            "flows": flows,
            "key_required": False,
            "read_path": "postgres",
            "last_sync": sync_state.get("last_sync"),
            "stale": sync_state.get("stale"),
        }
    elif country or commodity:
        trade_data = {
            "source": "Postgres ledger (empty)",
            "source_key": "postgres",
            "year": year,
            "hs_code": resolved_hs,
            "flows": [],
            "key_required": False,
            "read_path": "postgres",
            "last_sync": sync_state.get("last_sync"),
            "stale": True,
            "coverage_gap": True,
            "hint": "run graph-sync or comtrade ingest to populate oil_trade_flows",
        }

    return {
        "read_path": "postgres",
        "trade_data": trade_data,
        "sync_state": sync_state,
        "country_codes": codes or {},
    }
