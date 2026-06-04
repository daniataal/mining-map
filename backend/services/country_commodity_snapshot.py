"""Country + commodity extraction/export snapshot for license entities."""

from __future__ import annotations

import json
import re
from typing import Any, Optional

try:
    from backend.services.commodity_hs import hs_codes_for_entity, resolve_hs
    from backend.services.entity_trade_flows import (
        _load_license_row,
        _parse_year_from_period,
        _table_exists,
        query_stored_trade_flows,
    )
    from backend.services.ingest.gem_extraction_tracker_import import SOURCE_ID as GEM_SOURCE_ID
except ImportError:
    from services.commodity_hs import hs_codes_for_entity, resolve_hs  # type: ignore
    from services.entity_trade_flows import (  # type: ignore
        _load_license_row,
        _parse_year_from_period,
        _table_exists,
        query_stored_trade_flows,
    )
    from services.ingest.gem_extraction_tracker_import import SOURCE_ID as GEM_SOURCE_ID  # type: ignore

_GEM_SOURCE_ID = GEM_SOURCE_ID
_OIL_GAS_SECTOR = "oil_and_gas"

_PRODUCTION_KEY_HINTS = (
    "production",
    "bbl",
    "barrel",
    "mcm",
    "bcf",
    "mmboe",
    "volume",
    "output",
)


def _flow_kind(flow_type: str | None) -> Optional[str]:
    code = (flow_type or "").strip().upper()
    if code in {"X", "EXPORT"}:
        return "export"
    if code in {"M", "IMPORT"}:
        return "import"
    return None


def _aggregate_trade(flows: list[dict[str, Any]], *, max_partners: int = 3) -> dict[str, Any]:
    """Sum bilateral trade rows (exclude JODI supply snapshots)."""
    trade_rows = [f for f in flows if (f.get("data_source") or "").lower() != "jodi"]
    if not trade_rows:
        return {
            "latest_year": None,
            "export_usd": None,
            "import_usd": None,
            "export_kg": None,
            "import_kg": None,
            "top_export_partners": [],
            "top_import_partners": [],
            "data_sources": [],
        }

    years = [int(f["year"]) for f in trade_rows if f.get("year")]
    latest_year = max(years) if years else None
    year_rows = (
        [f for f in trade_rows if f.get("year") == latest_year]
        if latest_year is not None
        else trade_rows
    )

    export_usd = 0.0
    import_usd = 0.0
    export_kg = 0.0
    import_kg = 0.0
    has_export_usd = False
    has_import_usd = False
    has_export_kg = False
    has_import_kg = False
    export_partners: dict[str, float] = {}
    import_partners: dict[str, float] = {}
    sources: set[str] = set()

    for row in year_rows:
        kind = _flow_kind(row.get("flow_type"))
        if not kind:
            continue
        partner = (row.get("partner") or "").strip() or "Unknown"
        usd = row.get("trade_value_usd")
        kg = row.get("net_weight_kg")
        ds = (row.get("data_source") or "").strip()
        if ds:
            sources.add(ds)

        if usd is not None:
            val = float(usd)
            if kind == "export":
                export_usd += val
                has_export_usd = True
                export_partners[partner] = export_partners.get(partner, 0.0) + val
            else:
                import_usd += val
                has_import_usd = True
                import_partners[partner] = import_partners.get(partner, 0.0) + val
        if kg is not None:
            val_kg = float(kg)
            if kind == "export":
                export_kg += val_kg
                has_export_kg = True
            else:
                import_kg += val_kg
                has_import_kg = True

    def _top_partners(bucket: dict[str, float]) -> list[dict[str, Any]]:
        sorted_pairs = sorted(bucket.items(), key=lambda x: -x[1])[:max_partners]
        return [{"partner": p, "totalUsd": v} for p, v in sorted_pairs]

    return {
        "latest_year": latest_year,
        "export_usd": export_usd if has_export_usd else None,
        "import_usd": import_usd if has_import_usd else None,
        "export_kg": export_kg if has_export_kg else None,
        "import_kg": import_kg if has_import_kg else None,
        "top_export_partners": _top_partners(export_partners),
        "top_import_partners": _top_partners(import_partners),
        "data_sources": sorted(sources),
    }


def _commodity_tokens(commodity: str) -> list[str]:
    raw = re.split(r"[,;/|]+", (commodity or "").lower())
    tokens = [t.strip() for t in raw if t.strip()]
    hs = resolve_hs(commodity or "")
    if hs:
        tokens.append(hs)
    return tokens


def _is_petroleum_family(commodity: str) -> bool:
    hs = resolve_hs(commodity or "")
    return bool(hs and hs.startswith("27"))


def _commodity_matches_field(commodity: str, field_commodity: str) -> bool:
    lic = (commodity or "").lower()
    fld = (field_commodity or "").lower()
    if not lic or not fld:
        return True
    if _is_petroleum_family(commodity) and _is_petroleum_family(field_commodity):
        return True
    tokens = _commodity_tokens(commodity)
    if any(tok in fld or fld in tok for tok in tokens):
        return True
    lic_hs = resolve_hs(commodity)
    fld_hs = resolve_hs(field_commodity)
    if lic_hs and fld_hs:
        return lic_hs == fld_hs
    return False


def _parse_numeric_production_value(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if value >= 0 else None
    text = str(value).strip().replace(",", "")
    if not text or text.lower() in {"nan", "n/a", "-", ""}:
        return None
    match = re.search(r"[\d.]+", text)
    if not match:
        return None
    try:
        parsed = float(match.group(0))
    except ValueError:
        return None
    return parsed if parsed >= 0 else None


def _sum_production_dict(data: dict[str, Any]) -> tuple[float, list[str]]:
    total = 0.0
    labels: list[str] = []
    has_any = False
    for key, value in data.items():
        key_l = str(key).lower()
        if not any(hint in key_l for hint in _PRODUCTION_KEY_HINTS):
            continue
        parsed = _parse_numeric_production_value(value)
        if parsed is None:
            continue
        total += parsed
        has_any = True
        labels.append(str(key))
    return (total if has_any else 0.0, labels)


def _aggregate_gem_extraction(
    conn: Any,
    *,
    country: str,
    commodity: str,
) -> dict[str, Any]:
    country_l = country.strip().lower()
    if not country_l:
        return {
            "available": False,
            "tier": "none",
            "summary": None,
            "field_count": 0,
            "limitations": ["Country required for GEM field rollup."],
        }

    with conn.cursor() as cur:
        if not _table_exists(cur, "licenses"):
            return {
                "available": False,
                "tier": "none",
                "summary": None,
                "field_count": 0,
                "limitations": ["licenses table not available."],
            }
        cur.execute(
            """
            SELECT commodity, raw_payload
            FROM licenses
            WHERE source_id = %s
              AND LOWER(country) LIKE %s
              AND (sector = %s OR sector IS NULL)
            LIMIT 500
            """,
            (_GEM_SOURCE_ID, f"%{country_l}%", _OIL_GAS_SECTOR),
        )
        rows = cur.fetchall()

    matched = 0
    production_total = 0.0
    has_production = False
    for row in rows or []:
        if isinstance(row, dict):
            field_commodity = row.get("commodity") or ""
            raw_payload = row.get("raw_payload")
        else:
            field_commodity, raw_payload = row[0], row[1]
        if not _commodity_matches_field(commodity, field_commodity):
            continue
        matched += 1
        if not raw_payload:
            continue
        try:
            payload = json.loads(raw_payload) if isinstance(raw_payload, str) else raw_payload
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(payload, dict):
            continue
        prod = payload.get("production")
        if isinstance(prod, dict):
            subtotal, _ = _sum_production_dict(prod)
            if subtotal > 0:
                production_total += subtotal
                has_production = True

    if matched == 0:
        return {
            "available": False,
            "tier": "none",
            "summary": None,
            "field_count": 0,
            "limitations": [
                "No GEM extraction fields in DB for this country — run GEM tracker ingest.",
            ],
        }

    if has_production:
        summary = (
            f"{matched} GEM field(s) in {country}; aggregated production metrics from stored payloads."
        )
        return {
            "available": True,
            "tier": "field_aggregate",
            "summary": summary,
            "field_count": matched,
            "production_value_aggregate": production_total,
            "limitations": [
                "Country-level sum of GEM field production columns — not national official statistics.",
            ],
        }

    return {
        "available": True,
        "tier": "field_aggregate",
        "summary": f"{matched} GEM extraction field(s) in {country} (production sheet not merged for these rows).",
        "field_count": matched,
        "limitations": [
            "Field count only — re-ingest GEM workbook with production sheet for volumes.",
        ],
    }


def _latest_jodi_context(conn: Any, *, country: str) -> Optional[dict[str, Any]]:
    country_l = country.strip().lower()
    if not country_l:
        return None
    with conn.cursor() as cur:
        if not _table_exists(cur, "jodi_oil_snapshots"):
            return None
        cur.execute(
            """
            SELECT country, product, flow_indicator, period, value, unit, data_source
            FROM jodi_oil_snapshots
            WHERE LOWER(country) LIKE %s
            ORDER BY period DESC NULLS LAST
            LIMIT 3
            """,
            (f"%{country_l}%",),
        )
        rows = cur.fetchall()
    if not rows:
        return None
    lines: list[str] = []
    for row in rows:
        if isinstance(row, dict):
            product = row.get("product")
            indicator = row.get("flow_indicator")
            period = row.get("period")
            value = row.get("value")
            unit = row.get("unit")
        else:
            product, indicator, period, value, unit = row[1], row[2], row[3], row[4], row[5]
        year = _parse_year_from_period(period)
        unit_s = f" {unit}" if unit else ""
        lines.append(
            f"{product or 'Oil'} · {indicator or 'indicator'} ({year or period}): {value}{unit_s}"
        )
    return {
        "tier": "jodi_macro",
        "summary": "; ".join(lines),
        "limitations": [
            "JODI national oil supply/demand — supplementary macro context, not license-level extraction.",
        ],
    }


def collect_country_commodity_snapshot(
    conn: Any,
    entity_id: str,
    *,
    entity_kind: str = "license",
    limit: int = 80,
) -> dict[str, Any]:
    kind = (entity_kind or "license").strip().lower()
    if kind != "license":
        return {
            "entityId": entity_id,
            "entityKind": entity_kind,
            "warnings": [f"Country commodity snapshot supports license entities only (got {entity_kind})."],
        }

    license_row = _load_license_row(conn, entity_id)
    if not license_row:
        return {
            "entityId": entity_id,
            "entityKind": "license",
            "warnings": ["License not found."],
        }

    country = (license_row.get("country") or "").strip()
    commodity = (license_row.get("commodity") or "").strip()
    hs_codes = hs_codes_for_entity(commodity)
    limitations = [
        "Country-level data for the license commodity — not this company's customs filings.",
        "Trade values from stored UN Comtrade / Eurostat macro tables (bol_tier: macro).",
    ]
    warnings: list[str] = []

    if not hs_codes:
        warnings.append(
            "No HS mapping for this commodity — sync supports petroleum (HS27) and mapped mining metals."
        )
        trade_block = {
            "latest_year": None,
            "export_usd": None,
            "import_usd": None,
            "export_kg": None,
            "import_kg": None,
            "top_export_partners": [],
            "top_import_partners": [],
            "data_sources": [],
        }
        flows: list[dict[str, Any]] = []
    else:
        flows = query_stored_trade_flows(conn, country=country, hs_codes=hs_codes, limit=limit)
        trade_block = _aggregate_trade(flows)
        if not trade_block.get("data_sources"):
            warnings.append("No macro trade rows for this country/HS — run graph-sync.")

    commodity_l = commodity.lower()
    is_petroleum = bool(
        hs_codes
        and all(h.startswith("27") for h in hs_codes)
        or any(tok in commodity_l for tok in ("oil", "petroleum", "gas", "diesel", "lng", "lpg", "crude"))
    )

    extraction: dict[str, Any]
    if is_petroleum:
        extraction = _aggregate_gem_extraction(conn, country=country, commodity=commodity)
        jodi = _latest_jodi_context(conn, country=country)
        if jodi:
            extraction["jodi"] = jodi
            if extraction.get("tier") == "none" and not extraction.get("available"):
                extraction["tier"] = "jodi_macro"
                extraction["available"] = True
                extraction["summary"] = jodi.get("summary")
                extraction.setdefault("limitations", []).extend(jodi.get("limitations") or [])
    else:
        extraction = {
            "available": False,
            "tier": "none",
            "summary": None,
            "field_count": 0,
            "limitations": [
                "National production not in DB for this mining commodity — use export totals as trade proxy.",
            ],
        }

    return {
        "entityId": entity_id,
        "entityKind": "license",
        "company": license_row.get("company"),
        "country": country,
        "commodity": commodity,
        "hs_codes": hs_codes,
        "bol_tier": "macro",
        "trade": trade_block,
        "extraction": extraction,
        "limitations": limitations,
        "warnings": warnings,
        "sync_cta": "POST /api/admin/oil-live/graph-sync",
        "provenance": "oil_trade_flows + commodity_trade_flows + GEM extraction fields + jodi_oil_snapshots",
    }


def serialize_country_commodity_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    trade = payload.get("trade") or {}
    extraction = dict(payload.get("extraction") or {})
    jodi = extraction.pop("jodi", None)

    out_extraction = {
        "available": extraction.get("available", False),
        "tier": extraction.get("tier"),
        "summary": extraction.get("summary"),
        "fieldCount": extraction.get("field_count", 0),
        "productionValueAggregate": extraction.get("production_value_aggregate"),
        "limitations": extraction.get("limitations") or [],
    }
    if jodi:
        out_extraction["jodi"] = {
            "tier": jodi.get("tier"),
            "summary": jodi.get("summary"),
            "limitations": jodi.get("limitations") or [],
        }

    return {
        "entityId": payload.get("entityId"),
        "entityKind": payload.get("entityKind"),
        "company": payload.get("company"),
        "country": payload.get("country"),
        "commodity": payload.get("commodity"),
        "hsCodes": payload.get("hs_codes") or [],
        "bolTier": payload.get("bol_tier") or "macro",
        "trade": {
            "latestYear": trade.get("latest_year"),
            "exportUsd": trade.get("export_usd"),
            "importUsd": trade.get("import_usd"),
            "exportKg": trade.get("export_kg"),
            "importKg": trade.get("import_kg"),
            "topExportPartners": trade.get("top_export_partners") or [],
            "topImportPartners": trade.get("top_import_partners") or [],
            "dataSources": trade.get("data_sources") or [],
        },
        "extraction": out_extraction,
        "limitations": payload.get("limitations") or [],
        "warnings": payload.get("warnings") or [],
        "syncCta": payload.get("sync_cta"),
        "provenance": payload.get("provenance"),
    }
