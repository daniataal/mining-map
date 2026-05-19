"""Kazakhstan solid-minerals licence register (data.egov.kz).

Official dataset: https://data.egov.kz/datasets/view?index=reestr_vydannyh_licenzii_na_ne1

The national open-data API (v4) requires a free API key from data.egov.kz. Without
``KZ_EGOV_API_KEY`` this module does not run unattended sync — use admin CSV import
instead (see ``docs/kazakhstan_mining_import_template.csv``).

When a key is configured, records are upserted with ``record_origin=user_import_csv``
and ``source_id=kazakhstan_egov_mining_register``.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from typing import Any, Optional

DATASET_INDEX = "reestr_vydannyh_licenzii_na_ne1"
SOURCE_ID = "kazakhstan_egov_mining_register"
SOURCE_NAME = "Kazakhstan solid minerals licence register (data.egov.kz)"
EGOV_PORTAL_URL = (
    "https://data.egov.kz/datasets/view?index=reestr_vydannyh_licenzii_na_ne1"
)
API_BASE = os.getenv("KZ_EGOV_API_BASE", "https://data.egov.kz/api/v4")

# Common egov.kz / register field aliases (Kazakh + Russian transliterations).
_LICENSE_NUMBER_KEYS = (
    "licence_number",
    "license_number",
    "nomer_licenzii",
    "nomer_licenzii_na_pravo_polzovaniya",
    "license_no",
    "lic_no",
    "reg_number",
    "registration_number",
    "id",
)
_HOLDER_KEYS = (
    "company",
    "holder",
    "licensee",
    "naimenovanie",
    "naimenovanie_organizacii",
    "naimenovanie_subekta",
    "name_ru",
    "name_kz",
    "subsoil_user",
)
_LAT_KEYS = ("latitude", "lat", "shirota", "geo_lat", "y")
_LNG_KEYS = ("longitude", "lng", "lon", "dolgota", "geo_lon", "x")
_REGION_KEYS = ("region", "oblast", "obl", "kato", "administrative_unit")
_COMMODITY_KEYS = ("commodity", "mineral", "poleznoe_iskopaemoe", "minerals", "resource")
_STATUS_KEYS = ("status", "status_licenzii", "sostoyanie", "state")
_LICENSE_TYPE_KEYS = ("license_type", "vid", "vid_licenzii", "type")
_DATE_ISSUED_KEYS = ("date_issued", "data_vydachi", "issue_date", "data_registracii")


def _api_key() -> Optional[str]:
    return (os.getenv("KZ_EGOV_API_KEY") or "").strip() or None


def _first_str(raw: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        val = raw.get(key)
        if val is None:
            continue
        text = str(val).strip()
        if text and text.lower() not in ("null", "none", "nan"):
            return text
    return ""


def _parse_coord(raw: dict[str, Any], keys: tuple[str, ...]) -> Optional[float]:
    text = _first_str(raw, keys)
    if not text:
        return None
    try:
        return float(text.replace(",", "."))
    except (TypeError, ValueError):
        return None


def build_egov_record_url(licence_number: str) -> str:
    """Deep link to the dataset portal (no per-row public URL documented)."""
    q = urllib.parse.urlencode({"index": DATASET_INDEX})
    return f"https://data.egov.kz/datasets/view?{q}"


def normalize_egov_row(raw: dict[str, Any], *, fallback_index: int) -> dict[str, str]:
    """Map one egov register row to admin CSV import columns."""
    lic_num = _first_str(raw, _LICENSE_NUMBER_KEYS) or str(fallback_index)
    company = _first_str(raw, _HOLDER_KEYS) or lic_num
    lat = _parse_coord(raw, _LAT_KEYS)
    lng = _parse_coord(raw, _LNG_KEYS)

    # Some exports nest coordinates under geo / location objects.
    if lat is None or lng is None:
        for nested_key in ("geo", "location", "coordinates", "geom"):
            nested = raw.get(nested_key)
            if isinstance(nested, dict):
                lat = lat or _parse_coord(nested, _LAT_KEYS)
                lng = lng or _parse_coord(nested, _LNG_KEYS)

    status = _first_str(raw, _STATUS_KEYS) or "Active"
    return {
        "id": lic_num,
        "company": company,
        "country": "Kazakhstan",
        "region": _first_str(raw, _REGION_KEYS),
        "commodity": _first_str(raw, _COMMODITY_KEYS) or "Minerals",
        "license_type": _first_str(raw, _LICENSE_TYPE_KEYS) or "Mining licence",
        "status": status,
        "lat": str(lat) if lat is not None else "",
        "lng": str(lng) if lng is not None else "",
        "date_issued": _first_str(raw, _DATE_ISSUED_KEYS),
    }


def fetch_register_page(*, size: int = 500, from_offset: int = 0) -> list[dict[str, Any]]:
    """Fetch one page from data.egov.kz v4 API. Raises if API key missing."""
    api_key = _api_key()
    if not api_key:
        raise RuntimeError(
            "KZ_EGOV_API_KEY is not set — register at data.egov.kz and use CSV import "
            "via POST /api/admin/import/extracted-csv with countries=Kazakhstan"
        )

    source = json.dumps({"size": size, "from": from_offset})
    path = f"/{DATASET_INDEX}/v1?source={urllib.parse.quote(source)}"
    url = f"{API_BASE}{path}"
    req = urllib.request.Request(
        url,
        headers={"X-API-KEY": api_key, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for key in ("data", "items", "hits", "results", "records"):
            block = payload.get(key)
            if isinstance(block, list):
                return [row for row in block if isinstance(row, dict)]
    return []


def sync_kazakhstan_mining_register(conn: Any, *, max_rows: int = 5000) -> dict[str, Any]:
    """
    Pull egov register rows and upsert via csv_fallback normalizer when coordinates exist.

    Field names vary by dataset version; mapping uses normalize_egov_row. Prefer verified
    CSV import when API key or schema is unavailable.
    """
    try:
        from backend.services.ingest.csv_fallback_import import import_csv_text
    except ImportError:
        from services.ingest.csv_fallback_import import import_csv_text

    rows: list[dict[str, Any]] = []
    offset = 0
    page_size = 500
    while len(rows) < max_rows:
        page = fetch_register_page(size=page_size, from_offset=offset)
        if not page:
            break
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size

    if not rows:
        return {
            "status": "skipped",
            "reason": "no_rows_or_api_unavailable",
            "source_id": SOURCE_ID,
        }

    csv_rows = [normalize_egov_row(raw, fallback_index=idx) for idx, raw in enumerate(rows[:max_rows])]

    import csv as csv_module
    import io

    buf = io.StringIO()
    writer = csv_module.DictWriter(
        buf,
        fieldnames=[
            "id",
            "company",
            "country",
            "region",
            "commodity",
            "license_type",
            "status",
            "lat",
            "lng",
            "date_issued",
        ],
    )
    writer.writeheader()
    writer.writerows(csv_rows)
    result = import_csv_text(
        buf.getvalue(),
        filename="kazakhstan_egov.json",
        countries=["Kazakhstan"],
        source_name=SOURCE_NAME,
        sector="mining",
        conn=conn,
    )
    with_coords = sum(1 for row in csv_rows if row.get("lat") and row.get("lng"))
    return {
        "status": "success",
        "source_id": SOURCE_ID,
        "rows_fetched": len(rows),
        "rows_with_coordinates": with_coords,
        **result,
    }
