from __future__ import annotations

import csv
import io
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Optional

from .open_data_sync import _clean_text, _default_db_connection, _normalize_date

try:
    from backend.services.entity_relationships import sync_license_relationships_for_row
except ImportError:
    from services.entity_relationships import sync_license_relationships_for_row


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    return slug or "csv_import"


def _parse_float(value: Any) -> Optional[float]:
    cleaned = _clean_text(value)
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _normalize_country(value: Any) -> Optional[str]:
    cleaned = _clean_text(value)
    if not cleaned:
        return None
    mapping = {
        "south africa": "South Africa",
        "ghana": "Ghana",
        "botswana": "Botswana",
        "uganda": "Uganda",
        "sierra leone": "Sierra Leone",
        "namibia": "Namibia",
    }
    lowered = cleaned.lower()
    return mapping.get(lowered, cleaned)


def _extract_row_value(row: dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = _clean_text(row.get(key))
        if value:
            return value

    normalized_lookup = {
        str(key).strip().lower().replace(" ", "_"): value for key, value in row.items()
    }
    for key in keys:
        value = _clean_text(normalized_lookup.get(key.strip().lower().replace(" ", "_")))
        if value:
            return value

    return None


def _infer_sector(row: dict[str, Any]) -> str:
    commodity = _extract_row_value(row, "commodity", "main commodity", "main_commodity")
    joined = " ".join(
        filter(
            None,
            [
                _clean_text(row.get("license_type")),
                commodity,
                _clean_text(row.get("company")),
            ],
        )
    ).lower()
    if any(token in joined for token in ("petroleum", "hydrocarbon", "oil", "gas")):
        return "oil_and_gas"
    return "mining"


def _fingerprint(record: dict[str, Any]) -> tuple[Any, ...]:
    lat = round(float(record["lat"]), 6) if record.get("lat") is not None else None
    lng = round(float(record["lng"]), 6) if record.get("lng") is not None else None
    issued = record["date_issued"].isoformat() if record.get("date_issued") is not None else None
    return (
        (record.get("company") or "").strip().lower(),
        (record.get("country") or "").strip().lower(),
        (record.get("license_type") or "").strip().lower(),
        (record.get("commodity") or "").strip().lower(),
        (record.get("region") or "").strip().lower(),
        lat,
        lng,
        issued,
    )


def normalize_csv_row(
    row: dict[str, Any],
    source_id: str,
    source_name: str,
    *,
    sector_override: Optional[str] = "mining",
) -> Optional[dict[str, Any]]:
    row_id = _clean_text(row.get("id"))
    country = _normalize_country(row.get("country"))
    if not row_id or not country:
        return None

    region = _clean_text(row.get("region")) or _clean_text(row.get("matched_location")) or ""
    commodity = _extract_row_value(row, "commodity", "main commodity", "main_commodity") or "Minerals"
    record_id = f"{source_id}:{row_id}"
    return {
        "id": record_id,
        "company": _clean_text(row.get("company")) or row_id,
        "country": country,
        "region": region,
        "commodity": commodity,
        "license_type": _clean_text(row.get("license_type")) or "Mining licence",
        "status": _clean_text(row.get("status")) or "Imported",
        "lat": _parse_float(row.get("lat")),
        "lng": _parse_float(row.get("lng")),
        "date_issued": _normalize_date(row.get("date_issued")),
        "phone_number": _clean_text(row.get("phone_number")),
        "contact_person": _clean_text(row.get("contact_person")),
        "sector": sector_override or _infer_sector(row),
        "record_origin": "user_import_csv",
        "source_id": source_id,
        "source_name": source_name,
        "source_url": None,
        "source_record_url": None,
        "source_updated_at": None,
        "raw_payload": json.dumps(row, ensure_ascii=True, sort_keys=True, default=str),
    }


UPSERT_SQL = """
    INSERT INTO licenses (
        id, company, country, region, commodity, license_type, status, lat, lng,
        date_issued, phone_number, contact_person, sector, record_origin, source_id,
        source_name, source_url, source_record_url, source_updated_at, raw_payload, last_synced_at
    )
    VALUES (
        %s, %s, %s, %s, %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s, CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO UPDATE SET
        company = EXCLUDED.company,
        country = EXCLUDED.country,
        region = EXCLUDED.region,
        commodity = EXCLUDED.commodity,
        license_type = EXCLUDED.license_type,
        status = EXCLUDED.status,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        date_issued = EXCLUDED.date_issued,
        phone_number = EXCLUDED.phone_number,
        contact_person = EXCLUDED.contact_person,
        sector = EXCLUDED.sector,
        record_origin = EXCLUDED.record_origin,
        source_id = EXCLUDED.source_id,
        source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url,
        source_record_url = EXCLUDED.source_record_url,
        source_updated_at = EXCLUDED.source_updated_at,
        raw_payload = EXCLUDED.raw_payload,
        last_synced_at = CURRENT_TIMESTAMP
    WHERE licenses.manually_edited IS NOT TRUE;
"""


def _load_existing_fingerprints(
    conn: Any,
    countries: Iterable[str],
    *,
    source_id_to_ignore: Optional[str] = None,
) -> set[tuple[Any, ...]]:
    countries = [country for country in countries if country]
    if not countries:
        return set()

    placeholders = ", ".join(["%s"] * len(countries))
    params: list[Any] = list(countries)
    extra_clause = ""
    if source_id_to_ignore:
        extra_clause = " AND COALESCE(source_id, '') != %s"
        params.append(source_id_to_ignore)

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT company, country, region, commodity, license_type, lat, lng, date_issued
            FROM licenses
            WHERE country IN ({placeholders})
              AND record_origin != 'bundled_json'
              {extra_clause}
            """,
            tuple(params),
        )
        fingerprints = set()
        for company, country, region, commodity, license_type, lat, lng, date_issued in cur.fetchall():
            fingerprints.add(
                (
                    (company or "").strip().lower(),
                    (country or "").strip().lower(),
                    (license_type or "").strip().lower(),
                    (commodity or "").strip().lower(),
                    (region or "").strip().lower(),
                    round(float(lat), 6) if lat is not None else None,
                    round(float(lng), 6) if lng is not None else None,
                    date_issued.isoformat() if date_issued is not None else None,
                )
            )
        return fingerprints


def import_csv_rows(
    rows: Iterable[dict[str, Any]],
    *,
    filename: str,
    countries: Optional[Iterable[str]] = None,
    source_name: Optional[str] = None,
    sector: str = "mining",
    conn: Any | None = None,
) -> dict[str, Any]:
    allowed_countries = {_normalize_country(country) for country in (countries or []) if _normalize_country(country)}
    batch_slug = _slugify(Path(filename).stem)
    source_id = f"user_csv:{batch_slug}"
    resolved_source_name = source_name or f"Official Registry ({Path(filename).stem.replace('_', ' ').title()})"

    normalized_records: list[dict[str, Any]] = []
    skipped_missing_keys = 0
    for row in rows:
        record = normalize_csv_row(
            row,
            source_id,
            resolved_source_name,
            sector_override=sector,
        )
        if record is None:
            skipped_missing_keys += 1
            continue
        if allowed_countries and record["country"] not in allowed_countries:
            continue
        normalized_records.append(record)

    own_connection = conn is None
    if conn is None:
        conn = _default_db_connection()

    try:
        existing_fingerprints = _load_existing_fingerprints(
            conn,
            sorted({record["country"] for record in normalized_records}),
            source_id_to_ignore=source_id,
        )
        seen_ids: set[str] = set()
        seen_fingerprints: set[tuple[Any, ...]] = set(existing_fingerprints)
        inserted = 0
        skipped_duplicates = 0
        per_country = Counter()
        per_sector = Counter()

        with conn.cursor() as cur:
            for record in normalized_records:
                if record["id"] in seen_ids:
                    skipped_duplicates += 1
                    continue
                seen_ids.add(record["id"])

                fp = _fingerprint(record)
                if fp in seen_fingerprints:
                    skipped_duplicates += 1
                    continue
                seen_fingerprints.add(fp)

                cur.execute(
                    UPSERT_SQL,
                    (
                        record["id"],
                        record["company"],
                        record["country"],
                        record["region"],
                        record["commodity"],
                        record["license_type"],
                        record["status"],
                        record["lat"],
                        record["lng"],
                        record["date_issued"],
                        record["phone_number"],
                        record["contact_person"],
                        record["sector"],
                        record["record_origin"],
                        record["source_id"],
                        record["source_name"],
                        record["source_url"],
                        record["source_record_url"],
                        record["source_updated_at"],
                        record["raw_payload"],
                    ),
                )
                sync_license_relationships_for_row(conn, record)
                inserted += 1
                per_country[record["country"]] += 1
                per_sector[record["sector"]] += 1

        conn.commit()
        return {
            "filename": filename,
            "source_id": source_id,
            "source_name": resolved_source_name,
            "rows_seen": len(normalized_records),
            "inserted_or_updated": inserted,
            "skipped_missing_keys": skipped_missing_keys,
            "skipped_duplicates": skipped_duplicates,
            "per_country": dict(per_country),
            "per_sector": dict(per_sector),
        }
    finally:
        if own_connection and conn is not None:
            conn.close()


def import_csv_text(
    csv_text: str,
    *,
    filename: str = "uploaded.csv",
    countries: Optional[Iterable[str]] = None,
    source_name: Optional[str] = None,
    sector: str = "mining",
    conn: Any | None = None,
) -> dict[str, Any]:
    reader = csv.DictReader(io.StringIO(csv_text))
    return import_csv_rows(
        list(reader),
        filename=filename,
        countries=countries,
        source_name=source_name,
        sector=sector,
        conn=conn,
    )


def import_csv_file(
    path: str,
    *,
    countries: Optional[Iterable[str]] = None,
    source_name: Optional[str] = None,
    sector: str = "mining",
    conn: Any | None = None,
) -> dict[str, Any]:
    with open(path, newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return import_csv_rows(
        rows,
        filename=Path(path).name,
        countries=countries,
        source_name=source_name,
        sector=sector,
        conn=conn,
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Import a user-provided mining CSV as official coverage.")
    parser.add_argument("path", help="Path to the CSV file to import")
    parser.add_argument(
        "--countries",
        default="",
        help="Comma-separated country allowlist, e.g. 'South Africa,Ghana'",
    )
    parser.add_argument("--source-name", default="", help="Optional source display name")
    parser.add_argument("--sector", default="mining", help="Sector label to assign to imported rows.")
    args = parser.parse_args()

    countries = [part.strip() for part in args.countries.split(",") if part.strip()]
    result = import_csv_file(
        args.path,
        countries=countries or None,
        source_name=args.source_name or None,
        sector=args.sector,
    )
    print(json.dumps(result, indent=2, ensure_ascii=True, default=str))
