#!/usr/bin/env python3
"""Generate bundled country-border assets from the upstream geo-countries dataset.

Defaults:
- Reads country names from the checked-in mining dataset.
- Downloads the current geo-countries GeoJSON from GitHub.
- Emits typed TS modules for both mobile and web map consumers.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LICENSES = ROOT / "mining-viz" / "src" / "data" / "licenses.json"
DEFAULT_MOBILE_OUT = ROOT / "meridian-mobile" / "src" / "data" / "countryBorders.ts"
DEFAULT_WEB_OUT = ROOT / "mining-viz" / "src" / "data" / "countryBorders.ts"
DEFAULT_SOURCE_URL = "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson"

# Common country-name variants seen across public datasets.
COUNTRY_ALIASES = {
    "cape verde": "cabo verde",
    "congo kinshasa": "democratic republic of the congo",
    "congo brazzaville": "republic of the congo",
    "cote divoire": "cote d ivoire",
    "dem rep congo": "democratic republic of the congo",
    "democratic republic of congo": "democratic republic of the congo",
    "drc": "democratic republic of the congo",
    "ivory coast": "cote d ivoire",
    "laos": "lao pdr",
    "myanmar burma": "myanmar",
    "palestine": "state of palestine",
    "republic of congo": "republic of the congo",
    "russia": "russian federation",
    "south korea": "korea",
    "swaziland": "eswatini",
    "syria": "syrian arab republic",
    "tanzania": "united republic of tanzania",
    "the bahamas": "bahamas",
    "the gambia": "gambia",
    "uae": "united arab emirates",
    "uk": "united kingdom",
    "usa": "united states of america",
    "united states": "united states of america",
    "venezuela": "venezuela bolivarian republic of",
    "viet nam": "vietnam",
}


def _normalize_country_name(value: str) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
        .strip()
    )
    ascii_value = ascii_value.replace("&", " and ")
    ascii_value = re.sub(r"[^a-z0-9]+", " ", ascii_value)
    ascii_value = re.sub(r"\s+", " ", ascii_value).strip()
    return COUNTRY_ALIASES.get(ascii_value, ascii_value)


def _load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _load_geojson_from_url(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.load(response)


def _collect_dataset_countries(licenses_path: Path) -> list[str]:
    data = _load_json(licenses_path)
    if not isinstance(data, list):
        raise SystemExit(f"Expected a list in {licenses_path}, got {type(data).__name__}")

    countries = sorted(
        {
            ((row.get("country") or "").strip() or "Ghana")
            for row in data
            if isinstance(row, dict)
        }
    )
    if not countries:
        raise SystemExit(f"No countries found in {licenses_path}")
    return countries


def _build_feature_index(feature_collection: dict[str, Any]) -> dict[str, dict[str, Any]]:
    features = feature_collection.get("features")
    if not isinstance(features, list):
        raise SystemExit("GeoJSON source does not contain a features array")

    index: dict[str, dict[str, Any]] = {}
    for feature in features:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties") or {}
        if not isinstance(properties, dict):
            continue

        candidate_names = {
            properties.get("ADMIN"),
            properties.get("name"),
            properties.get("NAME"),
            properties.get("formal_en"),
        }
        for name in candidate_names:
            if not name or not isinstance(name, str):
                continue
            index[_normalize_country_name(name)] = feature
    return index


def _select_features(
    requested_countries: list[str], feature_index: dict[str, dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[str]]:
    selected: list[dict[str, Any]] = []
    selected_keys: set[str] = set()
    missing: list[str] = []

    for country in requested_countries:
        key = _normalize_country_name(country)
        feature = feature_index.get(key)
        if feature is None:
            missing.append(country)
            continue
        if key in selected_keys:
            continue
        selected.append(feature)
        selected_keys.add(key)

    selected.sort(
        key=lambda feature: _normalize_country_name(
            str((feature.get("properties") or {}).get("ADMIN") or (feature.get("properties") or {}).get("name") or "")
        )
    )
    return selected, missing


def _render_ts_module(
    feature_collection: dict[str, Any], requested_countries: list[str], licenses_path: Path
) -> str:
    rel_licenses_path = licenses_path.relative_to(ROOT).as_posix()
    countries_comment = ", ".join(requested_countries)
    payload = json.dumps(feature_collection, indent=2, ensure_ascii=True)
    return (
        "// Generated by scripts/generate_country_borders.py.\n"
        f"// Source licenses: {rel_licenses_path}\n"
        f"// Included countries: {countries_comment}\n"
        "import type { FeatureCollection, Geometry, GeoJsonProperties } from 'geojson';\n\n"
        "const COUNTRY_BORDERS: FeatureCollection<Geometry, GeoJsonProperties> = "
        f"{payload};\n\n"
        "export default COUNTRY_BORDERS;\n"
    )


def _write_text(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--licenses",
        type=Path,
        default=DEFAULT_LICENSES,
        help=f"Path to the JSON licenses dataset (default: {DEFAULT_LICENSES})",
    )
    parser.add_argument(
        "--source-url",
        default=DEFAULT_SOURCE_URL,
        help=f"Upstream GeoJSON URL (default: {DEFAULT_SOURCE_URL})",
    )
    parser.add_argument(
        "--mobile-out",
        type=Path,
        default=DEFAULT_MOBILE_OUT,
        help=f"Output TS module for mobile (default: {DEFAULT_MOBILE_OUT})",
    )
    parser.add_argument(
        "--web-out",
        type=Path,
        default=DEFAULT_WEB_OUT,
        help=f"Output TS module for web (default: {DEFAULT_WEB_OUT})",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    licenses_path = args.licenses.resolve()
    mobile_out = args.mobile_out.resolve()
    web_out = args.web_out.resolve()

    requested_countries = _collect_dataset_countries(licenses_path)
    source_geojson = _load_geojson_from_url(args.source_url)
    feature_index = _build_feature_index(source_geojson)
    selected_features, missing = _select_features(requested_countries, feature_index)

    if missing:
        print("Could not match border features for:", file=sys.stderr)
        for country in missing:
            print(f"- {country}", file=sys.stderr)
        return 1

    subset = {
        "type": "FeatureCollection",
        "features": selected_features,
    }
    module_text = _render_ts_module(subset, requested_countries, licenses_path)

    _write_text(mobile_out, module_text)
    _write_text(web_out, module_text)

    print(f"Wrote {len(selected_features)} border features")
    print(f"  mobile: {mobile_out}")
    print(f"  web:    {web_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
