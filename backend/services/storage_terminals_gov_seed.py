"""Government open-data petroleum storage reference hubs (EIA, DOE, HSE, etc.).

Loads ``data/storage_terminals_gov_seed.json`` for sparse OSM enrichment only.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

try:
    from backend.services.storage_terminals_seed import (
        CuratedStorageTerminal,
        _external_id,
        _now_iso,
        enrich_osm_from_reference_hubs,
        normalize_curated_terminal,
    )
except ImportError:
    from services.storage_terminals_seed import (  # type: ignore
        CuratedStorageTerminal,
        _external_id,
        _now_iso,
        enrich_osm_from_reference_hubs,
        normalize_curated_terminal,
    )

try:
    from backend.services.repo_data_paths import repo_data_file
except ImportError:
    from services.repo_data_paths import repo_data_file  # type: ignore

GOV_SEED_PATH = repo_data_file("storage_terminals_gov_seed.json")
SOURCE_KIND = "government_open"


def _apply_eia_padd_capacity_overlay(
    hubs: list[dict[str, Any]],
    padd_snapshot: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    if not padd_snapshot:
        return hubs
    try:
        from backend.services.eia_imports import format_eia_padd_capacity_text
    except ImportError:
        from services.eia_imports import format_eia_padd_capacity_text  # type: ignore

    updated: list[dict[str, Any]] = []
    for hub in hubs:
        padd = str(hub.get("eiaPadd") or "").strip().upper()
        if not padd:
            updated.append(hub)
            continue
        row = padd_snapshot.get(padd)
        if not row:
            updated.append(hub)
            continue
        merged = dict(hub)
        merged["capacityText"] = format_eia_padd_capacity_text(row)
        prior_note = str(merged.get("enrichmentNote") or "").strip()
        live_note = f"Live EIA PADD storage overlay ({row.get('series_id')}, {row.get('period')})."
        merged["enrichmentNote"] = f"{prior_note} {live_note}".strip() if prior_note else live_note
        merged["eiaLiveStoragePeriod"] = row.get("period")
        merged["eiaLiveStorageMillionBbl"] = row.get("stocks_million_bbl")
        labels = list(merged.get("sourceLabels") or [])
        if "EIA live storage" not in labels:
            labels.append("EIA live storage")
        merged["sourceLabels"] = labels
        updated.append(merged)
    return updated


def _load_gov_records(path: Optional[Path] = None) -> list[CuratedStorageTerminal]:
    seed_path = path or GOV_SEED_PATH
    if not seed_path.is_file():
        return []
    payload = json.loads(seed_path.read_text(encoding="utf-8"))
    rows = payload.get("entities") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    records: list[CuratedStorageTerminal] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        country = str(row.get("country") or "").strip()
        lat = row.get("lat")
        lng = row.get("lng")
        if not name or not country or lat is None or lng is None:
            continue
        records.append(
            CuratedStorageTerminal(
                name=name,
                country=country,
                region=str(row.get("region") or country).strip(),
                lat=float(lat),
                lng=float(lng),
                entity_subtype=str(row.get("entity_subtype") or "storage_terminal").strip(),
                operator=(str(row.get("operator")).strip() if row.get("operator") else None),
                owner=(str(row.get("owner")).strip() if row.get("owner") else None),
                commodity=str(row.get("commodity") or "petroleum").strip(),
                capacity_text=(str(row.get("capacity_text")).strip() if row.get("capacity_text") else None),
                source_record_url=(str(row.get("source_record_url")).strip() if row.get("source_record_url") else None),
                notes=(str(row.get("notes")).strip() if row.get("notes") else None),
                eia_padd=(str(row.get("eia_padd")).strip().upper() if row.get("eia_padd") else None),
            )
        )
    return records


def load_government_storage_reference_hubs(fetched_at: Optional[str] = None) -> list[dict[str, Any]]:
    ts = fetched_at or _now_iso()
    hubs: list[dict[str, Any]] = []
    for record in _load_gov_records():
        entity = normalize_curated_terminal(record, ts)
        entity["id"] = f"gov_storage_{_external_id(record.name, record.country).removeprefix('curated_storage_')}"
        entity["sourceKind"] = SOURCE_KIND
        entity["recordOrigin"] = SOURCE_KIND
        entity["sourceName"] = "Government open petroleum storage references"
        entity["status"] = "Government open reference"
        labels = [label for label in (entity.get("sourceLabels") or []) if label != "Curated reference"]
        entity["sourceLabels"] = ["Government open data", *labels]
        if record.eia_padd:
            entity["eiaPadd"] = record.eia_padd
        hubs.append(entity)
    try:
        from backend.services.eia_imports import load_eia_padd_storage_overlay
    except ImportError:
        from services.eia_imports import load_eia_padd_storage_overlay  # type: ignore
    return _apply_eia_padd_capacity_overlay(hubs, load_eia_padd_storage_overlay())


def enrich_osm_from_government_reference(
    entities: list[dict[str, Any]],
    gov_hubs: list[dict[str, Any]],
    *,
    distance_km: float = 4.0,
) -> list[dict[str, Any]]:
    return enrich_osm_from_reference_hubs(
        entities,
        gov_hubs,
        distance_km=distance_km,
        enrichment_kind=SOURCE_KIND,
        source_label="Government open data",
        evidence_type="government_open_enrichment",
        summary_prefix="Sparse OSM geometry enriched from government open storage reference",
        confidence_boost=0.12,
        skip_if_enriched=True,
    )
