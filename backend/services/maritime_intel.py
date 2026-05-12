from __future__ import annotations

import asyncio
import csv
import json
import math
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote_plus, urlencode
from urllib.request import Request, urlopen


AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"
GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
UNLOCODE_CSV_URL = "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv"
WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql"

REQUEST_TIMEOUT_SECONDS = 12
UNLOCODE_CACHE_TTL_SECONDS = 60 * 60 * 24
AIS_CACHE_TTL_SECONDS = 60

# Major oil and gas corridors. This is intentionally broad enough for an MVP
# without subscribing to the entire globe, which would be noisy and expensive.
AISSTREAM_OIL_BBOXES = [
    [[28.0, 47.0], [18.0, 58.5]],     # Arabian Gulf
    [[32.5, 29.0], [12.0, 44.0]],     # Red Sea + Suez approaches
    [[46.0, -7.0], [30.0, 37.0]],     # Mediterranean
    [[14.0, -20.0], [-30.0, 20.0]],   # West Africa offshore
    [[31.0, -98.0], [18.0, -79.0]],   # Gulf of Mexico / Caribbean
    [[62.0, -5.0], [50.0, 9.0]],      # North Sea
    [[9.0, 95.0], [-8.0, 108.0]],     # Malacca / Singapore
]

OIL_PORT_KEYWORDS = (
    "oil",
    "gas",
    "lng",
    "lpg",
    "petro",
    "petrol",
    "terminal",
    "offshore",
    "energy",
    "refinery",
)

UNLOCODE_OFFICIAL_SOURCE_URL = "https://unece.org/trade/cefact/UNLOCODE-Download"

_unlocode_cache: dict[str, Any] = {"loaded_at": 0.0, "rows": []}
_ais_cache: dict[str, Any] = {"loaded_at": 0.0, "result": None}

_COORD_RE = re.compile(
    r"^(?P<lat_deg>\d{2})(?P<lat_min>\d{2})(?P<lat_hem>[NS])\s+(?P<lon_deg>\d{3})(?P<lon_min>\d{2})(?P<lon_hem>[EW])$"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return " ".join(value.split()).strip()
    return str(value).strip()


def _normalize_token(value: Any) -> str:
    text = _clean_text(value).lower()
    if not text:
        return ""
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def parse_unlocode_coordinates(value: str) -> tuple[Optional[float], Optional[float]]:
    raw = _clean_text(value)
    if not raw:
        return None, None
    match = _COORD_RE.match(raw)
    if not match:
        return None, None

    lat = int(match.group("lat_deg")) + int(match.group("lat_min")) / 60.0
    if match.group("lat_hem") == "S":
        lat *= -1

    lng = int(match.group("lon_deg")) + int(match.group("lon_min")) / 60.0
    if match.group("lon_hem") == "W":
        lng *= -1

    return lat, lng


def _is_port_row(function_code: str) -> bool:
    normalized = _clean_text(function_code)
    return bool(normalized) and normalized[0] == "1"


def _looks_energy_related(name: str, remarks: str) -> bool:
    haystack = f"{name} {remarks}".lower()
    return any(keyword in haystack for keyword in OIL_PORT_KEYWORDS)


def _country_port_role(name: str, remarks: str) -> str:
    if _looks_energy_related(name, remarks):
        return "energy_port"
    return "port"


def _fetch_text(url: str, timeout: int = REQUEST_TIMEOUT_SECONDS) -> str:
    req = Request(url, headers={"User-Agent": "mining-map-maritime-intel/1.0"})
    with urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8")


def _fetch_json(url: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    target_url = f"{url}?{urlencode(params)}" if params else url
    req = Request(
        target_url,
        headers={
            "Accept": "application/json",
            "User-Agent": "mining-map-maritime-intel/1.0",
        },
    )
    with urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


def _load_unlocode_ports(force_refresh: bool = False) -> list[dict[str, Any]]:
    age = time.time() - float(_unlocode_cache.get("loaded_at") or 0.0)
    if not force_refresh and _unlocode_cache.get("rows") and age < UNLOCODE_CACHE_TTL_SECONDS:
        return list(_unlocode_cache["rows"])

    try:
        csv_text = _fetch_text(UNLOCODE_CSV_URL)
        reader = csv.DictReader(csv_text.splitlines())
        rows: list[dict[str, Any]] = []
        for raw_row in reader:
            function_code = _clean_text(raw_row.get("Function"))
            if not _is_port_row(function_code):
                continue
            lat, lng = parse_unlocode_coordinates(_clean_text(raw_row.get("Coordinates")))
            if lat is None or lng is None:
                continue

            country_code = _clean_text(raw_row.get("Country")).upper()
            location = _clean_text(raw_row.get("Location")).upper()
            name = _clean_text(raw_row.get("Name"))
            remarks = _clean_text(raw_row.get("Remarks"))
            if not country_code or not location or not name:
                continue

            rows.append(
                {
                    "unlocode": f"{country_code}{location}",
                    "country_iso2": country_code,
                    "name": name,
                    "name_ascii": _clean_text(raw_row.get("NameWoDiacritics")) or name,
                    "subdivision": _clean_text(raw_row.get("Subdivision")) or None,
                    "status": _clean_text(raw_row.get("Status")) or None,
                    "function": function_code,
                    "remarks": remarks or None,
                    "lat": lat,
                    "lng": lng,
                    "role": _country_port_role(name, remarks),
                    "source_label": "UN/LOCODE",
                    "source_url": UNLOCODE_OFFICIAL_SOURCE_URL,
                }
            )

        _unlocode_cache["loaded_at"] = time.time()
        _unlocode_cache["rows"] = rows
        return list(rows)
    except Exception:
        return list(_unlocode_cache.get("rows") or [])


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_km = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)
    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_km * c


def find_nearest_ports(
    *,
    country_iso2: str = "",
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    rows = _load_unlocode_ports()
    if not rows:
        return []

    country_code = _clean_text(country_iso2).upper()
    scoped = [row for row in rows if not country_code or row["country_iso2"] == country_code]

    if lat is not None and lng is not None:
        enriched = []
        for row in scoped:
            distance = haversine_km(lat, lng, row["lat"], row["lng"])
            row_copy = dict(row)
            row_copy["distance_km"] = round(distance, 1)
            row_copy["confidence"] = 0.65 if row_copy["role"] == "energy_port" else 0.45
            enriched.append(row_copy)
        enriched.sort(key=lambda item: (item["distance_km"], item["name"]))
        return enriched[:limit]

    energy_first = sorted(
        scoped,
        key=lambda item: (0 if item["role"] == "energy_port" else 1, item["name"]),
    )
    results = []
    for row in energy_first[:limit]:
        row_copy = dict(row)
        row_copy["distance_km"] = None
        row_copy["confidence"] = 0.55 if row_copy["role"] == "energy_port" else 0.35
        results.append(row_copy)
    return results


def match_destination_to_port(destination: str, country_iso2: str = "") -> Optional[dict[str, Any]]:
    token = _normalize_token(destination)
    if not token:
        return None

    rows = _load_unlocode_ports()
    if not rows:
        return None

    country_code = _clean_text(country_iso2).upper()
    scoped = [row for row in rows if not country_code or row["country_iso2"] == country_code]
    if not scoped:
        scoped = rows

    best: tuple[float, dict[str, Any]] | None = None
    for row in scoped:
        tokens = {
            _normalize_token(row["name"]),
            _normalize_token(row["name_ascii"]),
            _normalize_token(row["unlocode"]),
        }
        score = 0.0
        if token in tokens:
            score = 1.0
        elif any(token in candidate or candidate in token for candidate in tokens if candidate):
            score = 0.82
        else:
            continue

        if best is None or score > best[0]:
            best = (score, row)

    if best is None:
        return None

    matched = dict(best[1])
    matched["matched_on"] = destination
    matched["confidence"] = best[0]
    return matched


def classify_ais_ship_type(type_code: Any) -> tuple[Optional[int], str]:
    try:
        code = int(type_code)
    except (TypeError, ValueError):
        return None, "Unknown"
    if 80 <= code <= 89:
        return code, "Tanker"
    if 70 <= code <= 79:
        return code, "Cargo"
    if 60 <= code <= 69:
        return code, "Passenger"
    return code, "Other"


def classify_evidence_type(title: str) -> str:
    normalized = _normalize_token(title)
    if any(term in normalized for term in ("buyer", "seller", "offtake", "supply deal", "purchase")):
        return "counterparty_signal"
    if any(term in normalized for term in ("sanction", "seized", "detained", "attack", "spill", "collision", "fire")):
        return "risk_signal"
    if any(term in normalized for term in ("tanker", "shipment", "cargo", "terminal", "port", "load", "loading", "discharge", "lng", "lpg")):
        return "shipment_signal"
    return "maritime_context"


def _build_gdelt_query(company: str, country: str, commodity: str, vessel_name: str) -> str:
    anchors = []
    if vessel_name:
        anchors.append(f'"{vessel_name}"')
    elif company:
        anchors.append(f'"{company}"')
    elif country:
        anchors.append(f'"{country}"')

    terms = ["(tanker OR vessel OR shipping OR terminal OR port OR cargo OR crude OR oil OR LNG OR LPG)"]
    commodity_token = _normalize_token(commodity)
    if commodity_token:
        if "gas" in commodity_token or "lng" in commodity_token or "lpg" in commodity_token:
            terms.append("(gas OR LNG OR LPG)")
        else:
            terms.append("(oil OR crude OR petroleum OR refinery)")
    if country and not vessel_name:
        terms.append(f'"{country}"')
    return " ".join(anchors + terms).strip()


def fetch_gdelt_evidence(
    *,
    company: str = "",
    country: str = "",
    commodity: str = "",
    vessel_name: str = "",
    limit: int = 8,
) -> list[dict[str, Any]]:
    query = _build_gdelt_query(company, country, commodity, vessel_name)
    if not query:
        return []

    try:
        payload = _fetch_json(
            GDELT_DOC_URL,
            {
                "query": query,
                "mode": "artlist",
                "format": "json",
                "maxrecords": limit,
                "sort": "DateDesc",
            },
        )
    except (HTTPError, URLError, TimeoutError, ValueError):
        return []

    articles = payload.get("articles") if isinstance(payload, dict) else None
    if not isinstance(articles, list):
        return []

    evidence = []
    for index, article in enumerate(articles):
        title = _clean_text(article.get("title")) or "Untitled article"
        evidence.append(
            {
                "id": f"gdelt-{index}-{hash(_clean_text(article.get('url'))) & 0xfffffff}",
                "title": title,
                "url": _clean_text(article.get("url")),
                "source_label": "GDELT DOC 2.0",
                "source_domain": _clean_text(article.get("domain")) or None,
                "seen_at": _clean_text(article.get("seendate")) or None,
                "evidence_type": classify_evidence_type(title),
                "confidence": 0.62 if vessel_name or company else 0.5,
                "summary": _clean_text(article.get("title")) or None,
                "matched_terms": [term for term in [company, country, commodity, vessel_name] if _clean_text(term)],
            }
        )
    return evidence


def fetch_wikidata_vessel_identity(*, imo: str = "", mmsi: str = "") -> Optional[dict[str, Any]]:
    identifier = re.sub(r"[^0-9]", "", imo or mmsi or "")
    if not identifier:
        return None

    property_id = "P458" if imo else "P587"
    sparql = f"""
    SELECT ?item ?itemLabel ?ownerLabel ?operatorLabel ?flagLabel ?registryPortLabel WHERE {{
      ?item wdt:{property_id} "{identifier}" .
      OPTIONAL {{ ?item wdt:P127 ?owner . }}
      OPTIONAL {{ ?item wdt:P137 ?operator . }}
      OPTIONAL {{ ?item wdt:P17 ?flag . }}
      OPTIONAL {{ ?item wdt:P532 ?registryPort . }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    LIMIT 1
    """

    try:
        payload = _fetch_json(WIKIDATA_SPARQL_URL, {"query": sparql, "format": "json"})
        bindings = payload.get("results", {}).get("bindings", [])
    except (HTTPError, URLError, TimeoutError, ValueError):
        return None

    if not bindings:
        return None

    row = bindings[0]
    return {
        "owner": row.get("ownerLabel", {}).get("value"),
        "operator": row.get("operatorLabel", {}).get("value"),
        "flag": row.get("flagLabel", {}).get("value"),
        "registry_port": row.get("registryPortLabel", {}).get("value"),
        "matched_by": "imo" if imo else "mmsi",
        "confidence": 0.66 if imo else 0.52,
        "source_label": "Wikidata",
        "source_url": "https://query.wikidata.org/",
    }


def build_maritime_relationships(
    *,
    identity: Optional[dict[str, Any]],
    vessel_name: str = "",
    imo: str = "",
    mmsi: str = "",
) -> list[dict[str, Any]]:
    if not identity:
        return []

    source_entity_ref = _clean_text(imo) or _clean_text(mmsi) or _clean_text(vessel_name) or "unknown-vessel"
    relationships: list[dict[str, Any]] = []
    for relationship_type in ("owner", "operator"):
        target_name = _clean_text((identity or {}).get(relationship_type))
        if not target_name:
            continue
        relationships.append(
            {
                "id": f"vessel:{source_entity_ref}:{relationship_type}:{target_name.lower()}",
                "source_entity_kind": "vessel",
                "source_entity_ref": source_entity_ref,
                "target_entity_kind": "entity",
                "target_entity_ref": None,
                "target_name": target_name,
                "relationship_type": relationship_type,
                "relationship_label": None,
                "ownership_pct": None,
                "effective_date": None,
                "source_name": identity.get("source_label"),
                "source_url": identity.get("source_url"),
                "source_type": "open_knowledge_graph",
                "confidence_score": identity.get("confidence"),
                "raw_payload": {
                    "matched_by": identity.get("matched_by"),
                    "flag": identity.get("flag"),
                    "registry_port": identity.get("registry_port"),
                },
                "extracted_from": f"wikidata.{relationship_type}",
                "verified_at": None,
                "last_seen_at": _now_iso(),
            }
        )
    return relationships


def build_company_links(company: str, owner: str = "", operator: str = "") -> list[dict[str, Any]]:
    candidates = []
    for label in [company, owner, operator]:
        clean = _clean_text(label)
        if clean and clean.lower() not in {item.lower() for item in candidates}:
            candidates.append(clean)

    links = []
    for candidate in candidates[:3]:
        encoded = quote_plus(candidate)
        links.append(
            {
                "label": f"OpenCorporates: {candidate}",
                "url": f"https://opencorporates.com/companies?q={encoded}",
                "source_label": "OpenCorporates",
                "description": "Open company-registry search",
                "company_name": candidate,
                "confidence": 0.5,
            }
        )
    return links


def build_counterparty_proxies(
    *,
    commodity: str = "",
    matched_port: Optional[dict[str, Any]] = None,
    nearest_ports: list[dict[str, Any]] | None = None,
    evidence: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    proxies: list[dict[str, Any]] = []
    commodity_label = _clean_text(commodity) or "oil and gas"

    if matched_port:
        proxies.append(
            {
                "id": "destination-port",
                "label": f"Destination port proxy: {matched_port['name']}",
                "description": (
                    f"Open/free MVP can treat {matched_port['name']} ({matched_port['country_iso2']}) as the likely discharge jurisdiction "
                    f"or routing anchor, but not as a confirmed buyer or seller."
                ),
                "proxy_type": "destination_port_proxy",
                "confidence": float(matched_port.get("confidence") or 0.0),
                "source_label": matched_port["source_label"],
                "url": matched_port.get("source_url"),
            }
        )

    if nearest_ports:
        first_port = nearest_ports[0]
        proxies.append(
            {
                "id": "nearest-port",
                "label": f"Nearest export route proxy: {first_port['name']}",
                "description": (
                    f"The nearest open port context for {commodity_label} is {first_port['name']}. "
                    "This helps route screening, but it is still not bill-of-lading proof."
                ),
                "proxy_type": "nearest_port_proxy",
                "confidence": float(first_port.get("confidence") or 0.0),
                "source_label": first_port["source_label"],
                "url": first_port.get("source_url"),
            }
        )

    for article in evidence or []:
        if article["evidence_type"] == "counterparty_signal":
            proxies.append(
                {
                    "id": article["id"],
                    "label": "News-based counterparty signal",
                    "description": article["title"],
                    "proxy_type": "news_counterparty_signal",
                    "confidence": float(article.get("confidence") or 0.0),
                    "source_label": article["source_label"],
                    "url": article.get("url"),
                }
            )
            if len(proxies) >= 4:
                break

    return proxies


def _parse_ais_message(raw_message: dict[str, Any]) -> tuple[Optional[str], dict[str, Any]]:
    message_type = _clean_text(raw_message.get("MessageType"))
    metadata = raw_message.get("MetaData") or raw_message.get("Metadata") or {}
    body_holder = raw_message.get("Message") or {}
    if isinstance(body_holder, dict):
        body = body_holder.get(message_type) or next(iter(body_holder.values()), {})
    else:
        body = {}

    mmsi = str(
        metadata.get("MMSI")
        or body.get("UserID")
        or body.get("MMSI")
        or ""
    ).strip()
    if not mmsi:
        return None, {}

    ship_name = _clean_text(metadata.get("ShipName") or body.get("Name"))
    lat = metadata.get("latitude")
    if lat is None:
        lat = metadata.get("Latitude", body.get("Latitude"))
    lng = metadata.get("longitude")
    if lng is None:
        lng = metadata.get("Longitude", body.get("Longitude"))

    parsed = {
        "mmsi": mmsi,
        "vessel_name": ship_name or f"MMSI {mmsi}",
        "lat": float(lat) if lat not in (None, "") else None,
        "lng": float(lng) if lng not in (None, "") else None,
        "observed_at": _clean_text(metadata.get("time_utc")) or _now_iso(),
        "speed_knots": body.get("Sog"),
        "course_over_ground": body.get("Cog"),
        "true_heading": body.get("TrueHeading"),
        "call_sign": _clean_text(body.get("CallSign")) or None,
        "imo": _clean_text(body.get("ImoNumber") or body.get("IMO") or body.get("Imo")) or None,
        "destination": _clean_text(body.get("Destination")) or None,
        "raw_type": body.get("Type") or body.get("TypeAndCargo") or body.get("ShipType"),
        "message_type": message_type,
    }
    return mmsi, parsed


async def _collect_ais_snapshot(timeout_seconds: float = 6.0, max_vessels: int = 24) -> dict[str, Any]:
    api_key = os.getenv("AISSTREAM_API_KEY", "").strip()
    if not api_key:
        return {
            "vessels": [],
            "source": "AISStream (not configured)",
            "data_as_of": _now_iso(),
            "live_positions_enabled": False,
            "limitations": [
                "AISStream requires AISSTREAM_API_KEY on the backend. Without it, the maritime map layer stays empty while dossier enrichment still works.",
            ],
        }

    try:
        import websockets  # type: ignore
    except Exception:
        return {
            "vessels": [],
            "source": "AISStream (websocket client unavailable)",
            "data_as_of": _now_iso(),
            "live_positions_enabled": False,
            "limitations": [
                "AISSTREAM_API_KEY is set, but the Python websockets package is unavailable in this runtime.",
            ],
        }

    vessels: dict[str, dict[str, Any]] = {}
    subscription = {
        "APIKey": api_key,
        "BoundingBoxes": AISSTREAM_OIL_BBOXES,
        "FilterMessageTypes": [
            "PositionReport",
            "StandardClassBPositionReport",
            "ExtendedClassBPositionReport",
            "ShipStaticData",
            "StaticDataReport",
        ],
    }

    try:
        async with websockets.connect(AISSTREAM_URL, ping_interval=None, close_timeout=1) as websocket:
            await websocket.send(json.dumps(subscription))
            started = time.monotonic()
            while time.monotonic() - started < timeout_seconds:
                remaining = timeout_seconds - (time.monotonic() - started)
                if remaining <= 0:
                    break
                try:
                    message_json = await asyncio.wait_for(websocket.recv(), timeout=min(1.0, remaining))
                except asyncio.TimeoutError:
                    continue

                raw_message = json.loads(message_json)
                mmsi, parsed = _parse_ais_message(raw_message)
                if not mmsi:
                    continue
                current = vessels.setdefault(mmsi, {"mmsi": mmsi})
                current.update({key: value for key, value in parsed.items() if value not in (None, "", [])})
                if len(vessels) >= max_vessels * 2:
                    break
    except Exception as exc:
        return {
            "vessels": [],
            "source": "AISStream",
            "data_as_of": _now_iso(),
            "live_positions_enabled": False,
            "limitations": [f"AIS snapshot failed: {exc}"],
        }

    results = []
    for vessel in vessels.values():
        ship_type_code, ship_type_label = classify_ais_ship_type(vessel.get("raw_type"))
        if ship_type_label not in {"Tanker", "Cargo"}:
            continue
        if vessel.get("lat") is None or vessel.get("lng") is None:
            continue
        matched_port = match_destination_to_port(vessel.get("destination") or "")
        if matched_port is None:
            nearest = find_nearest_ports(lat=vessel["lat"], lng=vessel["lng"], limit=1)
            matched_port = nearest[0] if nearest else None
        results.append(
            {
                "id": f"ais:{vessel['mmsi']}",
                "mmsi": vessel["mmsi"],
                "vessel_name": vessel.get("vessel_name") or f"MMSI {vessel['mmsi']}",
                "lat": vessel["lat"],
                "lng": vessel["lng"],
                "observed_at": vessel.get("observed_at") or _now_iso(),
                "source_label": "AISStream",
                "source_url": "https://aisstream.io/documentation",
                "speed_knots": vessel.get("speed_knots"),
                "course_over_ground": vessel.get("course_over_ground"),
                "true_heading": vessel.get("true_heading"),
                "ship_type_code": ship_type_code,
                "ship_type_label": ship_type_label,
                "call_sign": vessel.get("call_sign"),
                "imo": vessel.get("imo"),
                "destination": vessel.get("destination"),
                "nearest_port": matched_port,
            }
        )

    results.sort(key=lambda item: str(item.get("observed_at") or ""), reverse=True)
    return {
        "vessels": results[:max_vessels],
        "source": "AISStream chokepoint snapshot",
        "data_as_of": _now_iso(),
        "live_positions_enabled": True,
        "limitations": [
            "AISStream is a live open/free feed with backend API-key setup; this MVP samples major oil and gas chokepoints rather than every ocean basin.",
            "AIS ownership/operator enrichment depends on whether the MMSI/IMO can be matched in open sources such as Wikidata.",
        ],
    }


def get_maritime_vessel_feed(max_vessels: int = 24) -> dict[str, Any]:
    age = time.time() - float(_ais_cache.get("loaded_at") or 0.0)
    if _ais_cache.get("result") and age < AIS_CACHE_TTL_SECONDS:
        cached = dict(_ais_cache["result"])
        cached["cached"] = True
        return cached

    result = asyncio.run(_collect_ais_snapshot(max_vessels=max_vessels))
    _ais_cache["loaded_at"] = time.time()
    _ais_cache["result"] = result
    return dict(result)


def get_maritime_context(
    *,
    company: str = "",
    country: str = "",
    country_iso2: str = "",
    commodity: str = "",
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    vessel_name: str = "",
    mmsi: str = "",
    imo: str = "",
    destination: str = "",
) -> dict[str, Any]:
    identity = fetch_wikidata_vessel_identity(imo=imo, mmsi=mmsi)
    relationships = build_maritime_relationships(
        identity=identity,
        vessel_name=vessel_name,
        imo=imo,
        mmsi=mmsi,
    )
    company_links = build_company_links(
        company=company or vessel_name,
        owner=(identity or {}).get("owner") or "",
        operator=(identity or {}).get("operator") or "",
    )
    matched_destination_port = match_destination_to_port(destination, country_iso2=country_iso2)
    nearest_ports = find_nearest_ports(country_iso2=country_iso2, lat=lat, lng=lng, limit=5)
    evidence = fetch_gdelt_evidence(
        company=company,
        country=country,
        commodity=commodity,
        vessel_name=vessel_name,
    )
    counterparty_proxies = build_counterparty_proxies(
        commodity=commodity,
        matched_port=matched_destination_port,
        nearest_ports=nearest_ports,
        evidence=evidence,
    )

    source_labels = ["UN/LOCODE", "GDELT DOC 2.0", "OpenCorporates search"]
    if identity:
        source_labels.append("Wikidata")

    limitations = [
        "Open/free data does not provide reliable bill-of-lading buyer/seller coverage at commercial depth.",
        "Buyer/seller context here is a proxy assembled from ports, corporate registries, Wikidata vessel links, and news evidence.",
        "GDELT evidence is news-derived and should be treated as screening context, not documentary proof of title or cargo ownership.",
    ]
    if not identity:
        limitations.append(
            "No open vessel ownership/operator match was found in Wikidata for the provided IMO/MMSI."
        )

    return {
        "source_labels": source_labels,
        "data_as_of": _now_iso(),
        "company_links": company_links,
        "nearest_ports": nearest_ports,
        "evidence": evidence,
        "identity": identity,
        "relationships": relationships,
        "counterparty_proxies": counterparty_proxies,
        "bol_coverage_note": (
            "True bill-of-lading buyer/seller data is usually commercial or government-restricted. "
            "This MVP exposes open proxies and raw evidence instead of pretending to have full B/L coverage."
        ),
        "limitations": limitations,
    }
