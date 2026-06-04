"""Open-government trade rows into trade_manifest_rows (UK ONS + user CSV dirs)."""

from __future__ import annotations

import csv
import json
import os
import urllib.request
from pathlib import Path
from typing import Any

UK_SYNC_ENABLED = (os.getenv("UK_TRADE_MANIFEST_SYNC_ENABLED") or "true").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}

UK_MANIFEST_CSV_DIR = (os.getenv("UK_MANIFEST_CSV_DIR") or "").strip()
BRAZIL_MANIFEST_CSV_DIR = (os.getenv("BRAZIL_MANIFEST_CSV_DIR") or "").strip()
USER_MANIFEST_CSV_DIR = (os.getenv("USER_MANIFEST_CSV_DIR") or "").strip()

# ONS bilateral trade sample (macro; labeled honestly when not company-level)
_ONS_JSON = (
    "https://www.ons.gov.uk/generator?format=json&uri=/economy/nationalaccounts/balanceofpayments/timeseries/ihbh"
)

# Brazil Comex-style CSV contract (at least one party + period or HS)
BRAZIL_MANIFEST_REQUIRED_ANY = frozenset(
    {
        "importer_name",
        "importer",
        "consignee",
        "exporter_name",
        "exporter",
        "shipper",
    }
)
BRAZIL_MANIFEST_RECOMMENDED = frozenset(
    {
        "hs_code",
        "hs",
        "ncm",
        "period_year",
        "year",
        "period_month",
        "month",
        "port_name",
        "port",
        "reporter_country",
        "country",
        "flow_type",
        "value_usd",
        "value",
        "quantity",
        "cnpj_importer",
        "cnpj_exporter",
    }
)


def ensure_trade_manifest_table(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS trade_manifest_rows (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                data_source TEXT NOT NULL,
                bol_tier TEXT NOT NULL DEFAULT 'customs_open',
                source_record_url TEXT,
                reporter_country TEXT,
                partner_country TEXT,
                hs_code TEXT,
                commodity_family TEXT,
                flow_type TEXT,
                period_year INT,
                period_month INT,
                importer_name TEXT,
                exporter_name TEXT,
                product_description TEXT,
                quantity NUMERIC,
                quantity_unit TEXT,
                value_usd NUMERIC,
                port_name TEXT,
                vessel_name TEXT,
                raw JSONB DEFAULT '{}'::jsonb,
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            """
        )


def sync_uk_open_trade_rows(conn: Any) -> dict[str, Any]:
    if not UK_SYNC_ENABLED:
        return {"status": "skipped", "reason": "UK_TRADE_MANIFEST_SYNC_ENABLED is off"}

    ensure_trade_manifest_table(conn)
    total = 0
    total += _ingest_manifest_csv_dir(conn, UK_MANIFEST_CSV_DIR, data_source="uk_hmrc_open", tier="customs_open")
    total += _ingest_manifest_csv_dir(conn, USER_MANIFEST_CSV_DIR, data_source="user_upload", tier="user_upload")
    total += _ingest_ons_macro(conn)
    return {"status": "ok", "rows_upserted": total}


def _normalize_header(name: str) -> str:
    return (name or "").strip().lower().replace(" ", "_")


def validate_manifest_csv_headers(fieldnames: list[str] | None, *, data_source: str) -> dict[str, Any]:
    """Return validation metadata; Brazil sources get stricter guidance."""
    headers = {_normalize_header(h) for h in (fieldnames or []) if h}
    if not headers:
        return {"valid": False, "reason": "empty header row", "headers": []}

    has_party = bool(headers & BRAZIL_MANIFEST_REQUIRED_ANY)
    out: dict[str, Any] = {
        "valid": has_party,
        "headers": sorted(headers),
        "has_party_column": has_party,
    }
    if data_source == "brazil_comex_open":
        missing_recommended = sorted(BRAZIL_MANIFEST_RECOMMENDED - headers)
        out["recommended_missing"] = missing_recommended
        out["tier_required"] = "customs_open"
        if not has_party:
            out["reason"] = (
                "Brazil CSV must include importer and/or exporter column "
                "(importer_name, exporter_name, consignee, shipper, …)"
            )
    elif not has_party:
        out["reason"] = "CSV must include importer and/or exporter column"
    return out


def sync_brazil_open_trade_rows(conn: Any) -> dict[str, Any]:
    """Brazil Comex-style open CSV dir → trade_manifest_rows (customs_open)."""
    enabled = (os.getenv("BRAZIL_TRADE_MANIFEST_SYNC_ENABLED") or "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }
    if not enabled:
        return {"status": "skipped", "reason": "BRAZIL_TRADE_MANIFEST_SYNC_ENABLED is off"}
    ensure_trade_manifest_table(conn)
    total, file_reports = _ingest_manifest_csv_dir(
        conn,
        BRAZIL_MANIFEST_CSV_DIR,
        data_source="brazil_comex_open",
        tier="customs_open",
        validate_headers=True,
    )
    return {"status": "ok", "rows_upserted": total, "files": file_reports}


def ingest_user_manifest_csv(conn: Any, file_path: str, *, consent: bool = True) -> dict[str, Any]:
    """Admin/user CSV upload — tier=user_upload."""
    ensure_trade_manifest_table(conn)
    if not consent:
        return {"status": "error", "message": "consent required for user_upload tier"}
    path = Path(file_path)
    if not path.is_file():
        return {"status": "error", "message": "file not found"}
    n = _ingest_single_csv(conn, path, data_source="user_upload", tier="user_upload")
    return {"status": "ok", "rows_upserted": n, "file": str(path)}


def _ingest_manifest_csv_dir(
    conn: Any,
    directory: str,
    *,
    data_source: str,
    tier: str,
    validate_headers: bool = False,
) -> int | tuple[int, list[dict[str, Any]]]:
    if not directory or not Path(directory).is_dir():
        if validate_headers:
            return 0, []
        return 0
    total = 0
    file_reports: list[dict[str, Any]] = []
    for path in Path(directory).glob("*.csv"):
        if validate_headers:
            n, report = _ingest_single_csv(
                conn, path, data_source=data_source, tier=tier, validate_headers=True
            )
            total += n
            file_reports.append(report)
        else:
            total += _ingest_single_csv(conn, path, data_source=data_source, tier=tier)
    if validate_headers:
        return total, file_reports
    return total


def _ingest_single_csv(
    conn: Any,
    path: Path,
    *,
    data_source: str,
    tier: str,
    validate_headers: bool = False,
) -> int | tuple[int, dict[str, Any]]:
    if tier != "customs_open" and data_source == "brazil_comex_open":
        tier = "customs_open"

    report: dict[str, Any] = {"file": str(path), "rows_upserted": 0, "tier": tier}
    count = 0
    with path.open(encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        header_check = validate_manifest_csv_headers(reader.fieldnames, data_source=data_source)
        report["header_validation"] = header_check
        if validate_headers and not header_check.get("valid"):
            report["status"] = "rejected"
            report["reason"] = header_check.get("reason")
            return 0, report

        with conn.cursor() as cur:
            for row in reader:
                norm_row = {_normalize_header(k): v for k, v in row.items()}
                importer = (
                    norm_row.get("importer_name")
                    or norm_row.get("importer")
                    or norm_row.get("consignee")
                    or ""
                ).strip()
                exporter = (
                    norm_row.get("exporter_name")
                    or norm_row.get("exporter")
                    or norm_row.get("shipper")
                    or ""
                ).strip()
                if not importer and not exporter:
                    continue
                if tier != "customs_open":
                    continue
                period_year_raw = norm_row.get("period_year") or norm_row.get("year") or ""
                period_month_raw = norm_row.get("period_month") or norm_row.get("month") or ""
                cur.execute(
                    """
                    INSERT INTO trade_manifest_rows (
                        data_source, bol_tier, source_record_url,
                        reporter_country, partner_country, hs_code, commodity_family,
                        flow_type, period_year, period_month, importer_name, exporter_name,
                        product_description, quantity, quantity_unit, value_usd, port_name, raw
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                    )
                    ON CONFLICT DO NOTHING
                    """,
                    (
                        data_source,
                        tier,
                        norm_row.get("source_record_url") or norm_row.get("url"),
                        norm_row.get("reporter_country") or norm_row.get("country") or "Brazil",
                        norm_row.get("partner_country") or norm_row.get("partner"),
                        norm_row.get("hs_code") or norm_row.get("hs") or norm_row.get("ncm"),
                        norm_row.get("commodity_family") or norm_row.get("product"),
                        norm_row.get("flow_type") or "import",
                        int(period_year_raw) if str(period_year_raw).isdigit() else None,
                        int(period_month_raw) if str(period_month_raw).isdigit() else None,
                        importer or None,
                        exporter or None,
                        norm_row.get("product_description") or norm_row.get("product"),
                        _float(norm_row.get("quantity")),
                        norm_row.get("quantity_unit") or "kg",
                        _float(norm_row.get("value_usd") or norm_row.get("value")),
                        norm_row.get("port_name") or norm_row.get("port"),
                        json.dumps({**dict(row), "normalized_headers": norm_row}),
                    ),
                )
                count += 1
    report["rows_upserted"] = count
    report["status"] = "ok" if count else "empty"
    if validate_headers:
        return count, report
    return count


def _ingest_ons_macro(conn: Any) -> int:
    try:
        with urllib.request.urlopen(_ONS_JSON, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return 0
    months = payload.get("months") or []
    values = payload.get("data", {}).get("months") or payload.get("data", {}).get("value") or []
    if not months:
        return 0
    count = 0
    with conn.cursor() as cur:
        for i, period in enumerate(months[-24:]):
            try:
                val = float((values[i] if i < len(values) else 0) or 0)
            except (TypeError, ValueError):
                val = 0
            year = int(str(period)[:4]) if len(str(period)) >= 4 else None
            cur.execute(
                """
                INSERT INTO trade_manifest_rows (
                    data_source, bol_tier, source_record_url,
                    reporter_country, partner_country, hs_code, commodity_family,
                    flow_type, period_year, importer_name, value_usd, raw
                ) VALUES (
                    'uk_ons', 'macro', %s,
                    'United Kingdom', 'World', '2709', 'crude',
                    'import', %s, 'UK aggregate (ONS)', %s, %s::jsonb
                )
                ON CONFLICT DO NOTHING;
                """,
                (
                    _ONS_JSON,
                    year,
                    val * 1_000_000,
                    json.dumps({"period": period, "ons": True}),
                ),
            )
            count += 1
    return count


def _float(raw: Any) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        return float(str(raw).replace(",", ""))
    except ValueError:
        return None
