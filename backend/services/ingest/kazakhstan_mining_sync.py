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


def _api_key() -> Optional[str]:
    return (os.getenv("KZ_EGOV_API_KEY") or "").strip() or None


def build_egov_record_url(licence_number: str) -> str:
    """Deep link to the dataset portal (no per-row public URL documented)."""
    q = urllib.parse.urlencode({"index": DATASET_INDEX})
    return f"https://data.egov.kz/datasets/view?{q}"


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
        for key in ("data", "items", "hits", "results"):
            block = payload.get(key)
            if isinstance(block, list):
                return [row for row in block if isinstance(row, dict)]
    return []


def sync_kazakhstan_mining_register(conn: Any, *, max_rows: int = 5000) -> dict[str, Any]:
    """
    Pull egov register rows and upsert via csv_fallback normalizer when coordinates exist.

    Field names vary by dataset version; mapping is best-effort. Prefer verified CSV
  import when API key or schema is unavailable.
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

    # Map egov rows to admin CSV columns (best-effort; adjust after mapping probe).
    csv_rows: list[dict[str, str]] = []
    for idx, raw in enumerate(rows[:max_rows]):
        lic_num = str(
            raw.get("licence_number")
            or raw.get("license_number")
            or raw.get("nomer_licenzii")
            or raw.get("id")
            or idx
        ).strip()
        company = str(
            raw.get("company")
            or raw.get("naimenovanie")
            or raw.get("holder")
            or raw.get("licensee")
            or lic_num
        ).strip()
        lat = raw.get("latitude") or raw.get("lat") or raw.get("shirota")
        lng = raw.get("longitude") or raw.get("lng") or raw.get("dolgota")
        csv_rows.append(
            {
                "id": lic_num,
                "company": company,
                "country": "Kazakhstan",
                "region": str(raw.get("region") or raw.get("oblast") or ""),
                "commodity": str(raw.get("commodity") or raw.get("mineral") or "Minerals"),
                "license_type": str(raw.get("license_type") or raw.get("vid") or "Mining licence"),
                "status": str(raw.get("status") or "Active"),
                "lat": str(lat) if lat not in (None, "") else "",
                "lng": str(lng) if lng not in (None, "") else "",
                "date_issued": str(raw.get("date_issued") or raw.get("data_vydachi") or ""),
            }
        )

    import io
    import csv as csv_module

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
    return {
        "status": "success",
        "source_id": SOURCE_ID,
        "rows_fetched": len(rows),
        **result,
    }
