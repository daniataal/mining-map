"""
GEM Global Gas Infrastructure Tracker (GGIT) — LNG terminal ingest.

Reads the GGIT workbook LNG sheet(s) into ``gem_lng_terminals`` (PostGIS points).
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

try:
    import pandas as pd
except ImportError:  # pragma: no cover
    pd = None  # type: ignore

try:
    from backend.services.gem_lng_terminals import SOURCE_ID, ensure_gem_lng_tables
except ImportError:
    from services.gem_lng_terminals import SOURCE_ID, ensure_gem_lng_tables  # type: ignore

SOURCE_NAME = "GEM Global Gas Infrastructure Tracker (GGIT LNG, September 2025)"
SOURCE_URL = "https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/"
DEFAULT_FILENAME = "Global-Gas-Infrastructure-Tracker-GGIT-September-2025.xlsx"
LNG_SHEETS = (
    "LNG Terminals",
    "LNG Import Terminals",
    "LNG Export Trains",
    "LNG Export Terminals",
)
REPO_ROOT = Path(__file__).resolve().parents[3]


def default_workbook_path() -> Path:
    override = (os.getenv("GEM_GGIT_XLSX_PATH") or "").strip()
    if override:
        return Path(override).expanduser()
    return REPO_ROOT / DEFAULT_FILENAME


def gem_ggit_auto_ingest_enabled() -> bool:
    return (os.getenv("GEM_GGIT_AUTO_INGEST") or "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _clean_text(value: Any) -> Optional[str]:
    if value is None or (pd is not None and pd.isna(value)):
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return text


def _row_dict(row: Any) -> dict[str, Any]:
    if isinstance(row, dict):
        return {str(k): v for k, v in row.items()}
    return {str(k): row[k] for k in row.index}  # type: ignore[attr-defined]


def _parse_float(value: Any) -> Optional[float]:
    cleaned = _clean_text(value)
    if not cleaned:
        return None
    cleaned = cleaned.replace(",", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


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


def _split_party_list(raw: Any) -> list[str]:
    text = _clean_text(raw)
    if not text:
        return []
    parts = re.split(r"[,;|]|\s+/\s+|\s+&\s+|\band\b", text, flags=re.IGNORECASE)
    out: list[str] = []
    seen: set[str] = set()
    for part in parts:
        name = part.strip()
        if len(name) < 2:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def _first_col(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row:
            val = _clean_text(row.get(key))
            if val:
                return val
    return None


def normalize_lng_terminal_row(row: dict[str, Any], *, sheet_name: str = "") -> Optional[dict[str, Any]]:
    gem_location_id = _first_col(
        row,
        "GEM location ID",
        "GEM Location ID",
        "Location ID",
        "GEM terminal ID",
        "Terminal ID",
    )
    country = _first_col(row, "Country/Area", "Country", "Countries")
    terminal_name = _first_col(
        row,
        "Terminal Name",
        "Project",
        "Terminal",
        "Name",
        "Facility Name",
    )
    if not gem_location_id or not country:
        return None

    lat, lng = _parse_lat_lng(
        _first_col(row, "Latitude", "Lat"),
        _first_col(row, "Longitude", "Lng", "Long"),
    )
    if lat is None or lng is None:
        return None

    operators = _split_party_list(_first_col(row, "Operator(s)", "Operator", "Operators"))
    owners = _split_party_list(_first_col(row, "Owner(s)", "Owner", "Owners"))
    parents = _split_party_list(_first_col(row, "Parent(s)", "Parent", "Parents"))

    capacity_mtpa = _parse_float(
        _first_col(row, "Capacity (Mtpa)", "Capacity", "Capacity (million tonnes per annum)")
    )
    capacity_text = f"{capacity_mtpa:g} Mtpa" if capacity_mtpa is not None else _first_col(
        row, "Capacity text"
    )

    terminal_type = _first_col(
        row,
        "Terminal Type",
        "Type",
        "Project Type",
        "Facility Type",
    )
    if not terminal_type and sheet_name:
        if "export" in sheet_name.lower():
            terminal_type = "export"
        elif "import" in sheet_name.lower():
            terminal_type = "import"

    display_name = terminal_name or gem_location_id

    tags: dict[str, Any] = {
        "terminal_key": f"{SOURCE_ID}:{gem_location_id}",
        "gem_location_id": gem_location_id,
        "name": display_name,
        "terminal_name": terminal_name,
        "country": country,
        "city": _first_col(row, "City", "Location"),
        "state_province": _first_col(row, "State/Province", "Subnational unit"),
        "region": _first_col(row, "Region"),
        "terminal_type": terminal_type,
        "status": _first_col(row, "Status"),
        "capacity_mtpa": capacity_mtpa,
        "capacity_text": capacity_text,
        "location_accuracy": _first_col(row, "Location accuracy", "Location Accuracy"),
        "wiki_url": _first_col(row, "Wiki URL"),
        "operator": ", ".join(operators) if operators else None,
        "Operator(s)": _first_col(row, "Operator(s)", "Operator"),
        "owner": ", ".join(owners) if owners else None,
        "Owner(s)": _first_col(row, "Owner(s)", "Owner"),
        "Parent(s)": _first_col(row, "Parent(s)", "Parent"),
        "owner_gem_entity_id": _first_col(row, "Owner(s) GEM Entity ID", "Owner GEM Entity ID"),
        "parent_gem_entity_id": _first_col(row, "Parent GEM Entity ID"),
        "operators": operators,
        "owners": owners,
        "parents": parents,
        "primary_counterparty": operators[0] if operators else (owners[0] if owners else None),
        "start_year": _first_col(row, "Start year", "Start Year"),
        "source_id": SOURCE_ID,
        "source_name": SOURCE_NAME,
        "source_url": SOURCE_URL,
        "data_tier": "global_open_fallback",
        "sheet_name": sheet_name or None,
        "commercial_note": (
            "GEM LNG terminal research — verify berth contracts and storage separately."
        ),
    }
    geom = {"type": "Point", "coordinates": [lng, lat]}
    return {
        "terminal_key": tags["terminal_key"],
        "gem_location_id": gem_location_id,
        "tags": tags,
        "geom": geom,
    }


def _read_lng_sheets(path: Path) -> list[dict[str, Any]]:
    if pd is None:
        raise RuntimeError("pandas is required for GEM GGIT ingest (pip install pandas openpyxl)")
    engine = "openpyxl" if path.suffix.lower() == ".xlsx" else None
    xl = pd.ExcelFile(path, engine=engine)
    out: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for sheet in LNG_SHEETS:
        if sheet not in xl.sheet_names:
            continue
        df = pd.read_excel(path, sheet_name=sheet, engine=engine)
        for _, row in df.iterrows():
            normalized = normalize_lng_terminal_row(_row_dict(row), sheet_name=sheet)
            if not normalized:
                continue
            key = normalized["terminal_key"]
            if key in seen_keys:
                continue
            seen_keys.add(key)
            out.append(normalized)
    if not out:
        for sheet in xl.sheet_names:
            if "lng" not in sheet.lower():
                continue
            df = pd.read_excel(path, sheet_name=sheet, engine=engine)
            for _, row in df.iterrows():
                normalized = normalize_lng_terminal_row(_row_dict(row), sheet_name=sheet)
                if not normalized:
                    continue
                key = normalized["terminal_key"]
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                out.append(normalized)
    return out


def upsert_lng_terminals(conn: Any, terminals: list[dict[str, Any]]) -> int:
    ensure_gem_lng_tables(conn)
    fetched_at = datetime.now(timezone.utc)
    written = 0
    with conn.cursor() as cur:
        for terminal in terminals:
            geom_json = json.dumps(terminal["geom"])
            tags_json = json.dumps(terminal["tags"])
            cur.execute(
                """
                INSERT INTO gem_lng_terminals (terminal_key, gem_location_id, geom, tags, fetched_at)
                VALUES (
                    %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                    %s::jsonb,
                    %s
                )
                ON CONFLICT (terminal_key) DO UPDATE SET
                    gem_location_id = EXCLUDED.gem_location_id,
                    geom = EXCLUDED.geom,
                    tags = EXCLUDED.tags,
                    fetched_at = EXCLUDED.fetched_at;
                """,
                (
                    terminal["terminal_key"],
                    terminal["gem_location_id"],
                    geom_json,
                    tags_json,
                    fetched_at,
                ),
            )
            written += 1
    return written


def ingest_gem_ggit_lng_terminals(
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

    terminals = _read_lng_sheets(path)
    if not terminals:
        return {
            "status": "skipped",
            "reason": "no LNG terminal rows parsed (check sheet names / columns)",
            "source_id": SOURCE_ID,
            "workbook": str(path),
        }

    written = upsert_lng_terminals(conn, terminals)
    return {
        "status": "ok",
        "source_id": SOURCE_ID,
        "workbook": str(path),
        "rows_upserted": written,
        "terminal_count": len(terminals),
    }


def try_auto_ingest_gem_ggit_lng(
    conn: Any,
    *,
    workbook_path: Optional[str | Path] = None,
) -> dict[str, Any]:
    if not gem_ggit_auto_ingest_enabled():
        return {"status": "skipped", "reason": "GEM_GGIT_AUTO_INGEST disabled"}
    return ingest_gem_ggit_lng_terminals(conn, workbook_path=workbook_path)


def get_source_registry_entry() -> dict[str, Any]:
    return {
        "source_id": SOURCE_ID,
        "label": SOURCE_NAME,
        "url": SOURCE_URL,
        "tier": "global_open_fallback",
        "refresh": "manual xlsx + graph-sync",
    }
