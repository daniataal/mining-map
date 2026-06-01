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
    total = _ingest_manifest_csv_dir(
        conn, BRAZIL_MANIFEST_CSV_DIR, data_source="brazil_comex_open", tier="customs_open"
    )
    return {"status": "ok", "rows_upserted": total}


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


def _ingest_manifest_csv_dir(conn: Any, directory: str, *, data_source: str, tier: str) -> int:
    if not directory or not Path(directory).is_dir():
        return 0
    total = 0
    for path in Path(directory).glob("*.csv"):
        total += _ingest_single_csv(conn, path, data_source=data_source, tier=tier)
    return total


def _ingest_single_csv(conn: Any, path: Path, *, data_source: str, tier: str) -> int:
    count = 0
    with path.open(encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        with conn.cursor() as cur:
            for row in reader:
                importer = (row.get("importer_name") or row.get("importer") or row.get("consignee") or "").strip()
                exporter = (row.get("exporter_name") or row.get("exporter") or row.get("shipper") or "").strip()
                if not importer and not exporter:
                    continue
                cur.execute(
                    """
                    INSERT INTO trade_manifest_rows (
                        data_source, bol_tier, source_record_url,
                        reporter_country, partner_country, hs_code, commodity_family,
                        flow_type, period_year, importer_name, exporter_name,
                        product_description, quantity, quantity_unit, value_usd, port_name, raw
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                    )
                    ON CONFLICT DO NOTHING
                    """,
                    (
                        data_source,
                        tier,
                        row.get("source_record_url") or row.get("url"),
                        row.get("reporter_country") or row.get("country"),
                        row.get("partner_country") or row.get("partner"),
                        row.get("hs_code") or row.get("hs"),
                        row.get("commodity_family") or row.get("product"),
                        row.get("flow_type") or "import",
                        int(row["year"]) if (row.get("year") or "").isdigit() else None,
                        importer or None,
                        exporter or None,
                        row.get("product_description") or row.get("product"),
                        _float(row.get("quantity")),
                        row.get("quantity_unit") or "kg",
                        _float(row.get("value_usd") or row.get("value")),
                        row.get("port_name") or row.get("port"),
                        json.dumps(dict(row)),
                    ),
                )
                count += 1
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
