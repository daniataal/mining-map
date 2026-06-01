"""
GEM Global Oil and Gas Extraction Tracker — field-level xlsx ingest.

Reads ``Global-Oil-and-Gas-Extraction-Tracker-March-2026.xlsx`` (repo root or
``GEM_TRACKER_XLSX_PATH``). Upserts field-level extraction units into ``licenses``
with ``sector=oil_and_gas`` for the Oil & Gas map view.

Source: Global Energy Monitor (GEM), March 2026 release.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

try:
    import pandas as pd
except ImportError:  # pragma: no cover
    pd = None  # type: ignore

try:
    from backend.services.ingest.open_data_sync import (
        _clean_text,
        _join_parts,
        upsert_open_data_records,
    )
except ImportError:
    from services.ingest.open_data_sync import (  # type: ignore
        _clean_text,
        _join_parts,
        upsert_open_data_records,
    )

SOURCE_ID = "gem_global_extraction_tracker_march_2026"
SOURCE_NAME = "GEM Global Oil and Gas Extraction Tracker (March 2026)"
SOURCE_URL = "https://globalenergymonitor.org/projects/global-oil-gas-extraction-tracker/"
RECORD_ORIGIN = "global_open_fallback"
SECTOR = "oil_and_gas"

MAIN_SHEET = "Field-level main data"
RESERVES_SHEET = "Field-level reserves data"
PRODUCTION_SHEET = "Field-level production data"
DEFAULT_FILENAME = "Global-Oil-and-Gas-Extraction-Tracker-March-2026.xlsx"
SOURCE_RELEASE_AT = datetime(2026, 3, 1)

REPO_ROOT = Path(__file__).resolve().parents[3]


def default_workbook_path() -> Path:
    override = (os.getenv("GEM_TRACKER_XLSX_PATH") or "").strip()
    if override:
        return Path(override).expanduser()
    return REPO_ROOT / DEFAULT_FILENAME


def gem_tracker_auto_ingest_enabled() -> bool:
    return (os.getenv("GEM_TRACKER_AUTO_INGEST") or "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _safe_str(value: Any) -> Optional[str]:
    if value is None or (pd is not None and pd.isna(value)):
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return text


def _parse_float(value: Any) -> Optional[float]:
    cleaned = _safe_str(value)
    if not cleaned:
        return None
    try:
        parsed = float(cleaned)
    except ValueError:
        return None
    if parsed < -180 or parsed > 180:
        return None
    return parsed


def _parse_lat_lng(lat_raw: Any, lng_raw: Any) -> tuple[Optional[float], Optional[float]]:
    lat = _parse_float(lat_raw)
    lng = _parse_float(lng_raw)
    if lat is None or lng is None:
        return None, None
    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return None, None
    if lat == 0.0 and lng == 0.0:
        return None, None
    return lat, lng


def _row_dict(row: Any) -> dict[str, Any]:
    if isinstance(row, dict):
        return {str(k): v for k, v in row.items()}
    return {str(k): row[k] for k in row.index}  # type: ignore[attr-defined]


def _company_from_row(row: dict[str, Any]) -> str:
    for key in ("Operator", "Owner(s)", "Parent(s)", "Unit Name"):
        value = _clean_text(row.get(key))
        if value:
            return value
    unit_id = _clean_text(row.get("Unit ID"))
    return unit_id or "Unknown field"


def _license_type_from_row(row: dict[str, Any]) -> str:
    parts = [
        _clean_text(row.get("Production Type")),
        _clean_text(row.get("Onshore/Offshore")),
        _clean_text(row.get("Fuel type")),
    ]
    joined = _join_parts(*(p for p in parts if p))
    return joined or "Oil & gas extraction unit"


def _region_from_row(row: dict[str, Any]) -> str:
    return _join_parts(
        row.get("Subnational unit"),
        row.get("Basin"),
        row.get("Block(s)"),
    )


def _wiki_url(row: dict[str, Any]) -> Optional[str]:
    return _clean_text(row.get("Wiki URL (field)")) or _clean_text(row.get("Wiki URL (project)"))


def _status_label(row: dict[str, Any]) -> str:
    status = _clean_text(row.get("Status")) or "Unknown"
    detail = _clean_text(row.get("Status detail"))
    if detail and detail.lower() not in status.lower():
        return f"{status} ({detail})"
    return status


def _commodity_label(row: dict[str, Any]) -> str:
    fuel = _clean_text(row.get("Fuel type"))
    if not fuel:
        return "Oil & gas"
    return fuel.replace("_", " ").title()


def normalize_gem_field_row(
    row: dict[str, Any],
    *,
    reserves: Optional[dict[str, Any]] = None,
    production: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    unit_id = _clean_text(row.get("Unit ID"))
    country = _clean_text(row.get("Country/Area"))
    if not unit_id or not country:
        return None

    lat, lng = _parse_lat_lng(row.get("Latitude"), row.get("Longitude"))
    payload: dict[str, Any] = {"field": row}
    if reserves:
        payload["reserves"] = reserves
    if production:
        payload["production"] = production

    wiki = _wiki_url(row)
    return {
        "id": f"{SOURCE_ID}:{unit_id}",
        "company": _company_from_row(row),
        "country": country,
        "region": _region_from_row(row),
        "commodity": _commodity_label(row),
        "license_type": _license_type_from_row(row),
        "status": _status_label(row),
        "lat": lat,
        "lng": lng,
        "date_issued": None,
        "sector": SECTOR,
        "record_origin": RECORD_ORIGIN,
        "source_id": SOURCE_ID,
        "source_name": SOURCE_NAME,
        "source_url": SOURCE_URL,
        "source_record_url": wiki,
        "source_updated_at": SOURCE_RELEASE_AT.isoformat(),
        "raw_payload": json.dumps(payload, ensure_ascii=True, sort_keys=True, default=str),
    }


def _read_sheet(path: Path, sheet_name: str) -> Any:
    if pd is None:
        raise RuntimeError(
            "pandas is required for GEM tracker ingest (pip install pandas openpyxl)"
        )
    engine = "openpyxl" if path.suffix.lower() == ".xlsx" else None
    return pd.read_excel(path, sheet_name=sheet_name, engine=engine)


def _index_optional_sheet(df: Any) -> dict[str, dict[str, Any]]:
    if df is None or len(df) == 0:
        return {}
    indexed: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        row_dict = _row_dict(row)
        unit_id = _clean_text(row_dict.get("Unit ID"))
        if not unit_id:
            continue
        indexed[unit_id] = row_dict
    return indexed


def iter_gem_field_records(path: Path) -> list[dict[str, Any]]:
    main_df = _read_sheet(path, MAIN_SHEET)
    reserves_by_id: dict[str, dict[str, Any]] = {}
    production_by_id: dict[str, dict[str, Any]] = {}
    try:
        reserves_by_id = _index_optional_sheet(_read_sheet(path, RESERVES_SHEET))
    except Exception:
        reserves_by_id = {}
    try:
        production_by_id = _index_optional_sheet(_read_sheet(path, PRODUCTION_SHEET))
    except Exception:
        production_by_id = {}

    records: list[dict[str, Any]] = []
    for _, row in main_df.iterrows():
        row_dict = _row_dict(row)
        unit_id = _clean_text(row_dict.get("Unit ID"))
        record = normalize_gem_field_row(
            row_dict,
            reserves=reserves_by_id.get(unit_id) if unit_id else None,
            production=production_by_id.get(unit_id) if unit_id else None,
        )
        if record is not None:
            records.append(record)
    return records


def ingest_gem_extraction_tracker(
    conn: Any,
    *,
    workbook_path: Optional[str | Path] = None,
) -> dict[str, Any]:
    path = Path(workbook_path).expanduser() if workbook_path else default_workbook_path()
    if not path.is_file():
        return {
            "status": "skipped",
            "reason": f"workbook not found: {path}",
            "source_id": SOURCE_ID,
        }

    records = iter_gem_field_records(path)
    if not records:
        return {
            "status": "skipped",
            "reason": "no field-level rows parsed",
            "source_id": SOURCE_ID,
            "workbook": path.name,
        }

    written = upsert_open_data_records(conn, records, sync_contacts=False)
    with_coords = sum(1 for r in records if r.get("lat") is not None and r.get("lng") is not None)
    countries = sorted({r["country"] for r in records if r.get("country")})

    return {
        "status": "ok",
        "source_id": SOURCE_ID,
        "workbook": path.name,
        "rows_parsed": len(records),
        "rows_upserted": written,
        "rows_with_coordinates": with_coords,
        "countries_seen": countries[:25],
        "countries_count": len(countries),
    }


def try_auto_ingest_gem_tracker(
    conn: Any,
    *,
    workbook_path: Optional[str | Path] = None,
) -> dict[str, Any]:
    if not gem_tracker_auto_ingest_enabled():
        return {"status": "skipped", "reason": "GEM_TRACKER_AUTO_INGEST is off"}
    return ingest_gem_extraction_tracker(conn, workbook_path=workbook_path)


def get_source_registry_entry() -> dict[str, Any]:
    return {
        "source_kind": "global_open_fallback",
        "source_access": "open_reference_dataset",
        "coverage_state": "global_fallback_only",
        "provenance_note": (
            "GEM Global Oil and Gas Extraction Tracker (March 2026) — field-level extraction "
            "units worldwide. Open NGO reference; not an official licence or block registry."
        ),
        "coverage_scope": "global_reference",
        "jurisdiction_scope": "global_reference",
        "jurisdiction_label": None,
        "note": (
            "Point coordinates when present; many units rely on field outline WKT in raw_payload only."
        ),
    }
