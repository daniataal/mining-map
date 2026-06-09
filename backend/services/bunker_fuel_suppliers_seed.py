"""Curated licensed bunker / marine fuel supplier registers (hub playbook)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

try:
    from backend.services.repo_data_paths import repo_data_file
except ImportError:
    from services.repo_data_paths import repo_data_file  # type: ignore

SEED_PATH = repo_data_file("bunker_fuel_suppliers_seed.json")

SUPPLIER_TYPE_LABELS = {
    "bunker_supplier": "Licensed bunker supplier",
    "fuel_wholesaler": "Fuel wholesaler",
    "fuel_importer": "Petroleum products importer",
    "refinery_marketer": "Refinery / marketer",
    "trader": "Commodity trader",
}


def _normalize_name(name: str) -> str:
    text = re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()
    return " ".join(text.split())


def load_bunker_fuel_suppliers(path: Optional[Path] = None) -> dict[str, Any]:
    seed_path = path or SEED_PATH
    if not seed_path.is_file():
        return {"meta": {}, "hubs": []}
    payload = json.loads(seed_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("bunker_fuel_suppliers_seed.json must be a JSON object")
    return payload


def iter_supplier_records(payload: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    """Flatten hub supplier rows with hub context attached."""
    data = payload if payload is not None else load_bunker_fuel_suppliers()
    out: list[dict[str, Any]] = []
    for hub in data.get("hubs") or []:
        if not isinstance(hub, dict):
            continue
        for raw in hub.get("suppliers") or []:
            if not isinstance(raw, dict):
                continue
            name = str(raw.get("company_name") or "").strip()
            if not name or len(name) < 3:
                continue
            if "placeholder" in name.lower() or "port register" in name.lower():
                continue
            out.append(
                {
                    **raw,
                    "company_name": name,
                    "hub_key": hub.get("hub_key"),
                    "locode": hub.get("locode"),
                    "port_name": hub.get("port_name"),
                    "country": hub.get("country"),
                    "hub_lat": hub.get("lat"),
                    "hub_lng": hub.get("lng"),
                    "license_authority": hub.get("license_authority"),
                    "register_source_url": hub.get("register_source_url"),
                }
            )
    return out
