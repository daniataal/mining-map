"""Poland PGI MIDAS mining areas via ArcGIS MapServer (cbdgmapa.pgi.gov.pl).

Official service: https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/midas/MapServer
Layer 1 = obszary górnicze (mining areas); layer 2 = tereny górnicze.

Free open data (PGI-PIB). Records upsert with record_origin=open_data,
source_id=poland_pgi_midas_<layer>.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Callable, Optional

MIDAS_MAPSERVER = os.getenv(
    "PGI_MIDAS_MAPSERVER_URL",
    "https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/midas/MapServer",
)
SOURCE_NAME = "PGI MIDAS mining areas (Poland)"
RECORD_ORIGIN = "open_data"
PORTAL_URL = "https://mapy.pgi.gov.pl/"

# Layer ids: 1 obszary górnicze, 2 tereny górnicze (active layers on MapServer).
DEFAULT_LAYER_IDS: tuple[int, ...] = (1, 2)
MAX_PER_LAYER = max(100, int(os.getenv("PGI_SYNC_MAX_PER_LAYER", "2000")))
PAGE_SIZE = max(50, min(500, int(os.getenv("PGI_SYNC_PAGE_SIZE", "200"))))


def _user_agent() -> str:
    return os.getenv(
        "PGI_USER_AGENT",
        os.getenv(
            "OPEN_DATA_SYNC_USER_AGENT",
            "MeridianMiningMap/1.0 (PGI open data; contact admin)",
        ),
    )


def layer_source_id(layer_id: int) -> str:
    return f"poland_pgi_midas_layer{layer_id}"


def fetch_layer_page(
    layer_id: int,
    *,
    offset: int = 0,
    limit: int = PAGE_SIZE,
    urlopen: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    params = urllib.parse.urlencode(
        {
            "where": "1=1",
            "outFields": "*",
            "returnGeometry": "true",
            "f": "geojson",
            "outSR": "4326",
            "resultOffset": offset,
            "resultRecordCount": limit,
        }
    )
    url = f"{MIDAS_MAPSERVER.rstrip('/')}/{layer_id}/query?{params}"
    opener = urlopen or urllib.request.urlopen
    req = urllib.request.Request(url, headers={"User-Agent": _user_agent(), "Accept": "application/json"})
    with opener(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_date(raw: Any) -> Optional[str]:
    if not raw:
        return None
    text = str(raw).strip()
    if len(text) >= 10 and text[4] == "-":
        return text[:10]
    if len(text) >= 10 and text[2] == ".":
        try:
            return datetime.strptime(text[:10], "%d.%m.%Y").date().isoformat()
        except ValueError:
            pass
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


def normalize_midas_feature(feature: dict[str, Any], *, layer_id: int) -> Optional[dict[str, Any]]:
    props = feature.get("properties") or {}
    contour_id = str(props.get("ID_KONTURU") or props.get("OBJECTID") or feature.get("id") or "").strip()
    if not contour_id:
        return None

    register_no = str(props.get("NR_REJESTR") or "").strip()
    external_ref = register_no or contour_id
    source_id = layer_source_id(layer_id)
    license_id = f"{source_id}:{external_ref}"

    lat, lng = _geometry_centroid(feature.get("geometry"))
    company = str(props.get("NAZWA_OG") or props.get("WYD_WYZN") or props.get("NAZWA_ZLOZA") or external_ref).strip()
    commodity = str(props.get("KOPALINA") or props.get("NAZWA_ZLOZA") or "Minerals").strip()
    license_type = "Mining area" if layer_id == 1 else "Mining territory"
    status = str(props.get("STATUS") or "Active").strip()
    region = str(props.get("NADZOR_OUG") or "").strip()

    item_url = (
        f"{MIDAS_MAPSERVER.rstrip('/')}/{layer_id}/query?"
        f"where=ID_KONTURU%3D{urllib.parse.quote(contour_id)}&f=html"
    )

    return {
        "id": license_id,
        "company": company,
        "country": "Poland",
        "region": region,
        "commodity": commodity,
        "license_type": license_type,
        "status": status,
        "lat": lat,
        "lng": lng,
        "date_issued": _parse_date(props.get("DATA_USTANOWIENIA")),
        "sector": "mining",
        "record_origin": RECORD_ORIGIN,
        "source_id": source_id,
        "source_name": SOURCE_NAME,
        "source_url": PORTAL_URL,
        "source_record_url": item_url,
        "source_updated_at": _parse_date(props.get("DATA_WAZNOSCI")),
        "raw_payload": json.dumps(props, ensure_ascii=True, sort_keys=True, default=str),
    }


def fetch_layer_features(
    layer_id: int,
    *,
    max_features: int = MAX_PER_LAYER,
    urlopen: Callable[..., Any] | None = None,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    offset = 0
    while len(records) < max_features:
        page = fetch_layer_page(layer_id, offset=offset, limit=PAGE_SIZE, urlopen=urlopen)
        features = page.get("features") or []
        if not features:
            break
        for feat in features:
            if not isinstance(feat, dict):
                continue
            rec = normalize_midas_feature(feat, layer_id=layer_id)
            if rec and rec.get("lat") is not None and rec.get("lng") is not None:
                records.append(rec)
            if len(records) >= max_features:
                break
        if len(features) < PAGE_SIZE:
            break
        offset += len(features)
    return records


def sync_poland_pgi_mining(
    conn: Any,
    *,
    layer_ids: Optional[tuple[int, ...]] = None,
    max_per_layer: int = MAX_PER_LAYER,
    urlopen: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    try:
        from backend.services.ingest.open_data_sync import upsert_open_data_records
    except ImportError:
        from services.ingest.open_data_sync import upsert_open_data_records

    enabled = (os.getenv("PGI_MINING_SYNC_ENABLED") or "true").strip().lower()
    if enabled in {"0", "false", "no", "off"}:
        return {"status": "skipped", "reason": "PGI_MINING_SYNC_ENABLED is off"}

    targets = list(layer_ids or DEFAULT_LAYER_IDS)
    all_records: list[dict[str, Any]] = []
    layer_stats: list[dict[str, Any]] = []
    errors: list[str] = []

    for layer_id in targets:
        try:
            rows = fetch_layer_features(layer_id, max_features=max_per_layer, urlopen=urlopen)
            all_records.extend(rows)
            layer_stats.append(
                {"layer_id": layer_id, "source_id": layer_source_id(layer_id), "written": len(rows)}
            )
        except Exception as exc:
            errors.append(f"layer_{layer_id}: {exc}")

    deduped: dict[str, dict[str, Any]] = {r["id"]: r for r in all_records}
    written = upsert_open_data_records(conn, deduped.values(), sync_contacts=False)

    status = "success"
    if errors and written:
        status = "partial"
    elif errors and not written:
        status = "error"

    return {
        "status": status,
        "layers": layer_stats,
        "records_fetched": len(all_records),
        "records_written": written,
        "errors": errors,
    }
