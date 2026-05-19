"""Sweden SGU mineral permits via OGC API Features (api.sgu.se).

Official endpoint: https://api.sgu.se/oppnadata/mineralrattigheter/ogc/features/v1
License: CC0 1.0 (SGU open data).

Records upsert with record_origin=open_data and source_id=sweden_sgu_<collection>.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Callable, Iterable, Optional

OGC_BASE = os.getenv(
    "SGU_OGC_BASE_URL",
    "https://api.sgu.se/oppnadata/mineralrattigheter/ogc/features/v1",
)
SOURCE_NAME = "SGU mineral permits (OGC API Features)"
RECORD_ORIGIN = "open_data"

# Active / granted collections (skip expired/forbidden subsets by default).
DEFAULT_COLLECTIONS: tuple[str, ...] = (
    "bearbetningskoncessioner-ansokta",
    "bearbetningskoncessioner-beviljade",
    "markanvisningar-bk-ansokta",
    "markanvisningar-bk-beviljade",
    "ut-metaller-industrimineral-ansokta",
    "ut-metaller-industrimineral-beviljade",
    "ut-diamant-ansokta",
    "ut-diamant-beviljade",
)

MAX_PER_COLLECTION = max(100, int(os.getenv("SGU_SYNC_MAX_PER_COLLECTION", "1500")))
PAGE_LIMIT = max(50, min(500, int(os.getenv("SGU_SYNC_PAGE_LIMIT", "200"))))


def _user_agent() -> str:
    return os.getenv(
        "SGU_USER_AGENT",
        os.getenv(
            "OPEN_DATA_SYNC_USER_AGENT",
            "MeridianMiningMap/1.0 (SGU open data; contact admin)",
        ),
    )


def collection_source_id(collection_id: str) -> str:
    safe = collection_id.replace(" ", "_").lower()
    return f"sweden_sgu_{safe}"


def list_collections(*, urlopen: Callable[..., Any] | None = None) -> list[str]:
    url = f"{OGC_BASE.rstrip('/')}/collections?f=application/json"
    opener = urlopen or urllib.request.urlopen
    req = urllib.request.Request(url, headers={"User-Agent": _user_agent(), "Accept": "application/json"})
    with opener(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return [str(c.get("id")) for c in (payload.get("collections") or []) if c.get("id")]


def fetch_collection_page(
    collection_id: str,
    *,
    start_index: int = 0,
    limit: int = PAGE_LIMIT,
    urlopen: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    params = urllib.parse.urlencode(
        {"f": "application/geo+json", "limit": limit, "startIndex": start_index}
    )
    url = f"{OGC_BASE.rstrip('/')}/collections/{urllib.parse.quote(collection_id)}/items?{params}"
    opener = urlopen or urllib.request.urlopen
    req = urllib.request.Request(url, headers={"User-Agent": _user_agent(), "Accept": "application/geo+json"})
    with opener(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_date(raw: Any) -> Optional[str]:
    if not raw:
        return None
    text = str(raw).strip().replace("Z", "")
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text[:19], fmt).date().isoformat()
        except ValueError:
            continue
    return text[:10] if len(text) >= 10 else None


def _geometry_centroid(geometry: Optional[dict[str, Any]]) -> tuple[Optional[float], Optional[float]]:
    if not geometry:
        return None, None
    try:
        from backend.services.ingest.open_data_sync import arcgis_geometry_centroid
    except ImportError:
        from services.ingest.open_data_sync import arcgis_geometry_centroid

    gtype = geometry.get("type")
    if gtype == "Point":
        coords = geometry.get("coordinates")
        if isinstance(coords, (list, tuple)) and len(coords) >= 2:
            return float(coords[1]), float(coords[0])
    if gtype == "Polygon":
        rings = geometry.get("coordinates")
        if rings:
            return arcgis_geometry_centroid({"rings": rings})
    if gtype == "MultiPolygon":
        polys = geometry.get("coordinates") or []
        if polys and polys[0]:
            return arcgis_geometry_centroid({"rings": polys[0]})
    return arcgis_geometry_centroid(geometry)


def normalize_sgu_feature(
    feature: dict[str, Any],
    *,
    collection_id: str,
) -> Optional[dict[str, Any]]:
    props = feature.get("properties") or {}
    permit_id = str(props.get("permitid") or props.get("diarynr") or feature.get("id") or "").strip()
    if not permit_id:
        return None

    lat, lng = _geometry_centroid(feature.get("geometry"))
    company = str(props.get("owners") or props.get("name") or permit_id).strip()
    region = " | ".join(
        part
        for part in (props.get("county"), props.get("municipal"))
        if part and str(part).strip()
    )
    commodity = str(props.get("mineral") or "Minerals").strip()
    license_type = str(props.get("permittype") or collection_id).strip()
    status = str(props.get("status") or "Active").strip()
    source_id = collection_source_id(collection_id)
    external_ref = f"{collection_id}:{permit_id}"

    item_url = (
        f"{OGC_BASE.rstrip('/')}/collections/{urllib.parse.quote(collection_id)}"
        f"/items/{urllib.parse.quote(permit_id)}?f=application/geo%2Bjson"
    )

    return {
        "id": f"{source_id}:{permit_id}",
        "company": company,
        "country": "Sweden",
        "region": region,
        "commodity": commodity,
        "license_type": license_type,
        "status": status,
        "lat": lat,
        "lng": lng,
        "date_issued": _parse_date(props.get("appl_date")),
        "sector": "mining",
        "record_origin": RECORD_ORIGIN,
        "source_id": source_id,
        "source_name": SOURCE_NAME,
        "source_url": f"{OGC_BASE.rstrip('/')}/collections/{collection_id}",
        "source_record_url": item_url,
        "source_updated_at": _parse_date(props.get("export_date")),
        "raw_payload": json.dumps(props, ensure_ascii=True, sort_keys=True, default=str),
    }


def fetch_collection_features(
    collection_id: str,
    *,
    max_features: int = MAX_PER_COLLECTION,
    urlopen: Callable[..., Any] | None = None,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    start = 0
    while len(records) < max_features:
        page = fetch_collection_page(
            collection_id, start_index=start, limit=PAGE_LIMIT, urlopen=urlopen
        )
        features = page.get("features") or []
        if not features:
            break
        for feat in features:
            if not isinstance(feat, dict):
                continue
            rec = normalize_sgu_feature(feat, collection_id=collection_id)
            if rec and rec.get("lat") is not None and rec.get("lng") is not None:
                records.append(rec)
            if len(records) >= max_features:
                break
        returned = int(page.get("numberReturned") or len(features))
        if returned < PAGE_LIMIT:
            break
        start += returned
    return records


def sync_sweden_sgu_mining(
    conn: Any,
    *,
    collections: Optional[Iterable[str]] = None,
    max_per_collection: int = MAX_PER_COLLECTION,
    urlopen: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    try:
        from backend.services.ingest.open_data_sync import upsert_open_data_records
    except ImportError:
        from services.ingest.open_data_sync import upsert_open_data_records

    enabled = (os.getenv("SGU_MINING_SYNC_ENABLED") or "true").strip().lower()
    if enabled in {"0", "false", "no", "off"}:
        return {"status": "skipped", "reason": "SGU_MINING_SYNC_ENABLED is off"}

    targets = list(collections or DEFAULT_COLLECTIONS)
    if not targets:
        return {"status": "skipped", "reason": "no_collections"}

    all_records: list[dict[str, Any]] = []
    collection_stats: list[dict[str, Any]] = []
    errors: list[str] = []

    for coll in targets:
        try:
            rows = fetch_collection_features(coll, max_features=max_per_collection, urlopen=urlopen)
            all_records.extend(rows)
            collection_stats.append(
                {"collection_id": coll, "source_id": collection_source_id(coll), "written": len(rows)}
            )
        except Exception as exc:
            errors.append(f"{coll}: {exc}")

    deduped: dict[str, dict[str, Any]] = {r["id"]: r for r in all_records}
    written = upsert_open_data_records(conn, deduped.values(), sync_contacts=False)

    status = "success"
    if errors and written:
        status = "partial"
    elif errors and not written:
        status = "error"

    return {
        "status": status,
        "collections": collection_stats,
        "records_fetched": len(all_records),
        "records_written": written,
        "errors": errors,
    }
