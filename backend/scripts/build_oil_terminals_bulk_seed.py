#!/usr/bin/env python3
"""Build backend/data/oil_terminals_seed_bulk.json from Overpass world tiles."""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from backend.services.storage_terminals import WORLD_TILES, build_overpass_query, infer_terminal_subtype

OUT_PATH = REPO_ROOT / "backend" / "data" / "oil_terminals_seed_bulk.json"
OVERPASS_URLS = (
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)


def fetch_tile(bbox: tuple[float, float, float, float]) -> list[dict]:
    body = urllib.parse.urlencode({"data": build_overpass_query(bbox)}).encode("utf-8")
    headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        "User-Agent": "mining-map-bulk-seed/1.0",
    }
    for url in OVERPASS_URLS:
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, data=body, headers=headers)
                with urllib.request.urlopen(req, timeout=120) as response:
                    payload = json.load(response)
                return payload.get("elements", []) if isinstance(payload, dict) else []
            except Exception as exc:
                print(f"{url} attempt {attempt + 1}: {exc}", file=sys.stderr)
                time.sleep(3 * (attempt + 1))
    return []


def main() -> int:
    all_elements: dict[tuple[str, int], dict] = {}
    for tile_name, bbox in WORLD_TILES:
        elements = fetch_tile(bbox)
        print(f"{tile_name}: {len(elements)}", file=sys.stderr)
        for element in elements:
            key = (str(element.get("type")), int(element.get("id")))
            all_elements[key] = element
        time.sleep(1)

    entities: list[dict] = []
    for element in all_elements.values():
        tags = element.get("tags") or {}
        subtype, _, _ = infer_terminal_subtype(tags)
        if not subtype:
            continue
        lat = element.get("lat")
        lng = element.get("lon")
        if lat is None or lng is None:
            center = element.get("center") or {}
            lat = center.get("lat")
            lng = center.get("lon")
        if lat is None or lng is None:
            continue
        name = (
            tags.get("name")
            or tags.get("operator")
            or tags.get("owner")
            or f"OSM {element.get('type')} {element.get('id')}"
        )
        entities.append(
            {
                "osm_type": element.get("type"),
                "osm_id": element.get("id"),
                "lat": float(lat),
                "lng": float(lng),
                "tags": tags,
                "entity_subtype": subtype,
                "name": name,
            }
        )

    entities.sort(key=lambda row: (row.get("name") or "", row["osm_id"]))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(
            {
                "meta": {
                    "source": "OpenStreetMap public export via Overpass",
                    "source_kind": "osm_bulk_fallback",
                    "entity_count": len(entities),
                    "notes": (
                        "Offline fallback when live Overpass is unavailable in Docker/CI. "
                        "Regenerate with: python backend/scripts/build_oil_terminals_bulk_seed.py"
                    ),
                },
                "entities": entities,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"wrote {len(entities)} entities to {OUT_PATH}")
    return 0 if len(entities) >= 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
