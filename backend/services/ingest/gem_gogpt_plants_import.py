"""
GEM Global Oil and Gas Plant Tracker (GOGPT) — unit-level xlsx ingest.

Reads ``Global-Oil-and-Gas-Plant-Tracker-GOGPT-January-2026.xlsx`` sheet
``Gas & Oil Units`` into ``gem_plant_units`` (PostGIS points).

Surfaces owner / operator / parent / captive-industry fields for commercial outreach.
GEM does not publish tank lessors or storage lease parties — use counterparties as leads only.
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
    from backend.services.gem_plant_units import SOURCE_ID, ensure_gem_plant_tables
except ImportError:
    from services.gem_plant_units import SOURCE_ID, ensure_gem_plant_tables  # type: ignore


def _clean_text(value: Any) -> Optional[str]:
    if value is None or (pd is not None and pd.isna(value)):
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return text


SOURCE_NAME = "GEM Global Oil and Gas Plant Tracker (GOGPT, January 2026)"
SOURCE_URL = "https://globalenergymonitor.org/projects/global-oil-gas-plant-tracker/"
MAIN_SHEET = "Gas & Oil Units"
SUB_THRESHOLD_SHEET = "sub-threshold units"
DEFAULT_FILENAME = "Global-Oil-and-Gas-Plant-Tracker-GOGPT-January-2026.xlsx"
REPO_ROOT = Path(__file__).resolve().parents[3]


def default_workbook_path() -> Path:
    override = (os.getenv("GEM_GOGPT_XLSX_PATH") or "").strip()
    if override:
        return Path(override).expanduser()
    return REPO_ROOT / DEFAULT_FILENAME


def gem_gogpt_auto_ingest_enabled() -> bool:
    return (os.getenv("GEM_GOGPT_AUTO_INGEST") or "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def include_sub_threshold_units() -> bool:
    return (os.getenv("GEM_GOGPT_INCLUDE_SUB_THRESHOLD") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


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


def _build_counterparties(row: dict[str, Any]) -> list[dict[str, Any]]:
    """Structured parties for dossier / lease outreach (not verified lessors)."""
    parties: list[dict[str, Any]] = []
    for role, key, entity_key in (
        ("operator", "Operator(s)", None),
        ("owner", "Owner(s)", "Owner(s) GEM Entity ID"),
        ("parent", "Parent(s)", "Parent GEM Entity ID"),
    ):
        names = _split_party_list(row.get(key))
        entity_ids = _split_party_list(row.get(entity_key)) if entity_key else []
        if not names:
            continue
        parties.append(
            {
                "role": role,
                "names": names,
                "gem_entity_ids": entity_ids,
                "outreach_note": (
                    "GEM ownership/operations research — verify tank/storage contracts separately."
                ),
            }
        )
    equip = _clean_text(row.get("Equipment Manufacturer/Model"))
    if equip:
        parties.append(
            {
                "role": "equipment_vendor",
                "names": [equip],
                "gem_entity_ids": [],
                "outreach_note": "Turbine/engine supplier — possible EPC or maintenance contact.",
            }
        )
    captive = _clean_text(row.get("Captive industry use"))
    captive_type = _clean_text(row.get("Captive industry type"))
    if captive or captive_type:
        label = _clean_text(
            row.get("Captive non-industry use")
        ) or captive_type or captive
        if label:
            parties.append(
                {
                    "role": "captive_demand",
                    "names": [label],
                    "gem_entity_ids": [],
                    "outreach_note": (
                        "On-site or dedicated demand — may need logistics/storage near plant."
                    ),
                }
            )
    return parties


def _primary_counterparty(parties: list[dict[str, Any]]) -> Optional[str]:
    for role in ("operator", "owner", "parent", "captive_demand"):
        for block in parties:
            if block.get("role") == role and block.get("names"):
                return block["names"][0]
    return None


def normalize_plant_row(row: dict[str, Any]) -> Optional[dict[str, Any]]:
    gem_unit_id = _clean_text(row.get("GEM unit ID"))
    country = _clean_text(row.get("Country/Area"))
    if not gem_unit_id or not country:
        return None

    lat, lng = _parse_lat_lng(row.get("Latitude"), row.get("Longitude"))
    if lat is None or lng is None:
        return None

    parties = _build_counterparties(row)
    operators = _split_party_list(row.get("Operator(s)"))
    owners = _split_party_list(row.get("Owner(s)"))
    parents = _split_party_list(row.get("Parent(s)"))

    capacity_mw = _parse_float(row.get("Capacity (MW)"))
    capacity_text = f"{capacity_mw:g} MW" if capacity_mw is not None else None

    plant_name = _clean_text(row.get("Plant name"))
    unit_name = _clean_text(row.get("Unit name"))
    display_name = unit_name or plant_name or gem_unit_id

    tags: dict[str, Any] = {
        "unit_key": f"{SOURCE_ID}:{gem_unit_id}",
        "gem_unit_id": gem_unit_id,
        "gem_location_id": _clean_text(row.get("GEM location ID")),
        "name": display_name,
        "plant_name": plant_name,
        "unit_name": unit_name,
        "country": country,
        "city": _clean_text(row.get("City")),
        "state_province": _clean_text(row.get("State/Province")),
        "region": _clean_text(row.get("Region")),
        "fuel": _clean_text(row.get("Fuel")),
        "fuel_classification": _clean_text(row.get("Fuel classification?")),
        "capacity_mw": capacity_mw,
        "capacity_text": capacity_text,
        "status": _clean_text(row.get("Status")),
        "technology": _clean_text(row.get("Turbine/Engine Technology")),
        "equipment": _clean_text(row.get("Equipment Manufacturer/Model")),
        "chp": _clean_text(row.get("CHP")),
        "hydrogen_capable": _clean_text(row.get("Hydrogen capable?")),
        "ccs_attachment": _clean_text(row.get("CCS attachment?")),
        "location_accuracy": _clean_text(row.get("Location accuracy")),
        "wiki_url": _clean_text(row.get("Wiki URL")),
        "operator": ", ".join(operators) if operators else None,
        "Operator(s)": _clean_text(row.get("Operator(s)")),
        "owner": ", ".join(owners) if owners else None,
        "Owner(s)": _clean_text(row.get("Owner(s)")),
        "Parent(s)": _clean_text(row.get("Parent(s)")),
        "owner_gem_entity_id": _clean_text(row.get("Owner(s) GEM Entity ID")),
        "parent_gem_entity_id": _clean_text(row.get("Parent GEM Entity ID")),
        "operators": operators,
        "owners": owners,
        "parents": parents,
        "counterparties": parties,
        "primary_counterparty": _primary_counterparty(parties),
        "captive_industry_use": _clean_text(row.get("Captive industry use")),
        "captive_industry_type": _clean_text(row.get("Captive industry type")),
        "captive_non_industry_use": _clean_text(row.get("Captive non-industry use")),
        "start_year": _clean_text(row.get("Start year")),
        "retired_year": _clean_text(row.get("Retired year")),
        "planned_retire": _clean_text(row.get("Planned retire")),
        "source_id": SOURCE_ID,
        "source_name": SOURCE_NAME,
        "source_url": SOURCE_URL,
        "data_tier": "global_open_fallback",
        "commercial_note": (
            "GEM provides plant owners/operators and captive industrial users — not tank lessors. "
            "Cross-check storage terminals and trade flows before lease outreach."
        ),
    }
    geom = {"type": "Point", "coordinates": [lng, lat]}
    return {"unit_key": tags["unit_key"], "gem_unit_id": gem_unit_id, "tags": tags, "geom": geom}


def _read_units_sheet(path: Path, sheet_name: str) -> list[dict[str, Any]]:
    if pd is None:
        raise RuntimeError("pandas is required for GEM GOGPT ingest (pip install pandas openpyxl)")
    engine = "openpyxl" if path.suffix.lower() == ".xlsx" else None
    df = pd.read_excel(path, sheet_name=sheet_name, engine=engine)
    out: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        normalized = normalize_plant_row(_row_dict(row))
        if normalized:
            out.append(normalized)
    return out


def upsert_plant_units(conn: Any, units: list[dict[str, Any]]) -> int:
    ensure_gem_plant_tables(conn)
    fetched_at = datetime.now(timezone.utc)
    written = 0
    with conn.cursor() as cur:
        for unit in units:
            geom_json = json.dumps(unit["geom"])
            tags_json = json.dumps(unit["tags"])
            cur.execute(
                """
                INSERT INTO gem_plant_units (unit_key, gem_unit_id, geom, tags, fetched_at)
                VALUES (
                    %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                    %s::jsonb,
                    %s
                )
                ON CONFLICT (unit_key) DO UPDATE SET
                    gem_unit_id = EXCLUDED.gem_unit_id,
                    geom = EXCLUDED.geom,
                    tags = EXCLUDED.tags,
                    fetched_at = EXCLUDED.fetched_at;
                """,
                (unit["unit_key"], unit["gem_unit_id"], geom_json, tags_json, fetched_at),
            )
            written += 1
    return written


def ingest_gem_gogpt_plants(
    conn: Any,
    *,
    workbook_path: Optional[str | Path] = None,
    include_sub_threshold: Optional[bool] = None,
) -> dict[str, Any]:
    path = Path(workbook_path).expanduser() if workbook_path else default_workbook_path()
    if not path.is_file():
        return {
            "status": "skipped",
            "reason": f"workbook not found: {path}",
            "source_id": SOURCE_ID,
        }

    units = _read_units_sheet(path, MAIN_SHEET)
    sub_count = 0
    if include_sub_threshold if include_sub_threshold is not None else include_sub_threshold_units():
        try:
            sub_units = _read_units_sheet(path, SUB_THRESHOLD_SHEET)
            sub_count = len(sub_units)
            units.extend(sub_units)
        except Exception:
            sub_count = 0

    # Deduplicate by unit_key (main wins)
    by_key: dict[str, dict[str, Any]] = {}
    for unit in units:
        by_key[unit["unit_key"]] = unit
    unique = list(by_key.values())

    written = upsert_plant_units(conn, unique) if unique else 0
    with_parties = sum(1 for u in unique if u["tags"].get("counterparties"))

    return {
        "status": "ok",
        "source_id": SOURCE_ID,
        "workbook": path.name,
        "rows_with_coordinates": len(unique),
        "rows_upserted": written,
        "rows_with_counterparties": with_parties,
        "sub_threshold_included": sub_count > 0,
        "sub_threshold_rows": sub_count,
    }


def try_auto_ingest_gem_gogpt_plants(
    conn: Any,
    *,
    workbook_path: Optional[str | Path] = None,
) -> dict[str, Any]:
    if not gem_gogpt_auto_ingest_enabled():
        return {"status": "skipped", "reason": "GEM_GOGPT_AUTO_INGEST is off"}
    if not default_workbook_path().is_file():
        return {"status": "skipped", "reason": "GEM GOGPT workbook not present"}
    return ingest_gem_gogpt_plants(conn, workbook_path=workbook_path)


def get_source_registry_entry() -> dict[str, Any]:
    return {
        "source_kind": "global_open_fallback",
        "source_access": "open_reference_dataset",
        "coverage_state": "global_fallback_only",
        "provenance_note": (
            "GEM Global Oil and Gas Plant Tracker (GOGPT, January 2026). "
            "Owner/operator/parent and captive-industry fields for outreach — not tank lease parties."
        ),
        "coverage_scope": "global_reference",
        "jurisdiction_scope": "global_reference",
        "jurisdiction_label": None,
        "note": "Gas/oil-fired power and CHP units; cross-link to storage terminals and trade flows.",
    }
