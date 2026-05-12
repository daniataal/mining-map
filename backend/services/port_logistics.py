from __future__ import annotations

import csv
import io
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    from backend.country_borders import COUNTRY_BORDERS_PATH
except ImportError:
    from country_borders import COUNTRY_BORDERS_PATH

try:
    from backend.services.maritime_intel import haversine_km, find_nearest_ports, parse_unlocode_coordinates
except ImportError:
    from services.maritime_intel import haversine_km, find_nearest_ports, parse_unlocode_coordinates


UNLOCODE_CSV_URL = "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv"
UNLOCODE_OFFICIAL_SOURCE_URL = "https://unece.org/trade/cefact/UNLOCODE-Download"
UNLOCODE_BROWSER_URL = "https://unlocode.unece.org/"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc"

REQUEST_TIMEOUT_SECONDS = 20
OVERPASS_TIMEOUT_SECONDS = 35
LIST_CACHE_TTL_SECONDS = 60 * 60 * 24
DETAIL_CACHE_TTL_SECONDS = 60 * 30
MAX_NEARBY_PORT_DISTANCE_KM = 350.0
NEARBY_INFRA_RADIUS_METERS = 15000
MAP_RENDER_LIMIT = 3000

LOGISTICS_KEYWORD_RE = re.compile(
    r"(terminal|depot|logistics|freight|cargo|container|intermodal|icd|dry\s+port|free\s+zone|industrial\s+area)",
    re.I,
)
TERMINAL_KEYWORD_RE = re.compile(r"(terminal|quay|jetty|berth|harbour|harbor|dock|wharf)", re.I)

_list_cache: dict[str, Any] = {"loaded_at": 0.0, "response": None}
_detail_cache: dict[str, dict[str, Any]] = {}
_country_name_cache: dict[str, str] | None = None


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


def _fetch_text(url: str, timeout: int = REQUEST_TIMEOUT_SECONDS) -> str:
    req = Request(url, headers={"User-Agent": "mining-map-port-logistics/1.0"})
    with urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8")


def _fetch_json(url: str, params: Optional[dict[str, Any]] = None, timeout: int = REQUEST_TIMEOUT_SECONDS) -> dict[str, Any]:
    target = f"{url}?{urlencode(params)}" if params else url
    req = Request(
        target,
        headers={
            "Accept": "application/json",
            "User-Agent": "mining-map-port-logistics/1.0",
        },
    )
    with urlopen(req, timeout=timeout) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


def _fetch_overpass_json(query: str) -> dict[str, Any]:
    body = urlencode({"data": query}).encode("utf-8")
    req = Request(
        OVERPASS_URL,
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "User-Agent": "mining-map-port-logistics/1.0",
        },
    )
    with urlopen(req, timeout=OVERPASS_TIMEOUT_SECONDS) as response:
        return json.load(response)


def _country_names() -> dict[str, str]:
    global _country_name_cache
    if _country_name_cache is not None:
        return _country_name_cache

    payload = json.loads(Path(COUNTRY_BORDERS_PATH).read_text(encoding="utf-8"))
    mapping: dict[str, str] = {}
    for feature in payload.get("features", []):
        properties = feature.get("properties") or {}
        iso2 = _clean_text(
            properties.get("ISO_A2")
            or properties.get("iso_a2")
            or properties.get("ISO2")
            or properties.get("iso2")
        ).upper()
        name = _clean_text(
            properties.get("ADMIN")
            or properties.get("name")
            or properties.get("NAME")
            or properties.get("formal_en")
        )
        if len(iso2) == 2 and name:
            mapping[iso2] = name

    _country_name_cache = mapping
    return mapping


def _country_name_from_iso2(iso2: str) -> str:
    code = _clean_text(iso2).upper()
    if not code:
        return "Unknown"
    return _country_names().get(code, code)


def _function_flag(function_code: str, index: int, marker: str) -> bool:
    normalized = _clean_text(function_code).ljust(8, "-")
    return len(normalized) > index and normalized[index] == marker


def _looks_named_logistics_site(name: str, remarks: str) -> bool:
    haystack = f"{name} {remarks}"
    return bool(LOGISTICS_KEYWORD_RE.search(haystack))


def _infer_subtype(function_code: str, name: str, remarks: str) -> tuple[str, float, str]:
    maritime = _function_flag(function_code, 0, "1")
    rail = _function_flag(function_code, 1, "2")
    multimodal = _function_flag(function_code, 5, "6")
    haystack = f"{name} {remarks}"

    if maritime and TERMINAL_KEYWORD_RE.search(haystack):
        return (
            "terminal",
            0.93,
            "UN/LOCODE marks this location for maritime transport and the name/remarks indicate a terminal facility.",
        )
    if maritime:
        return (
            "port",
            0.97,
            "UN/LOCODE marks this location for maritime transport.",
        )
    if rail and _looks_named_logistics_site(name, remarks):
        return (
            "rail_terminal",
            0.9,
            "UN/LOCODE marks this location for rail transport and the name/remarks indicate a freight-facing terminal site.",
        )
    if multimodal and _looks_named_logistics_site(name, remarks):
        if re.search(r"(depot|icd|dry\s+port)", haystack, re.I):
            return (
                "depot",
                0.88,
                "UN/LOCODE marks this as a multimodal location and the name/remarks indicate a depot-style inland freight site.",
            )
        return (
            "logistics_hub",
            0.89,
            "UN/LOCODE marks this as a multimodal location and the name/remarks indicate a logistics hub or terminal site.",
        )
    return "", 0.0, ""


def _commodity_hints(name: str, remarks: str) -> list[str]:
    haystack = f"{name} {remarks}".lower()
    hints: list[str] = []
    for label, patterns in (
        ("containerized_trade", ("container", "free zone", "intermodal")),
        ("dry_bulk", ("bulk", "ore", "iron ore", "coal", "bauxite", "alumina", "cement", "clinker")),
        ("agri_bulk", ("grain", "fertilizer", "agri", "wheat", "soy", "corn")),
        ("petroleum", ("oil", "petroleum", "crude", "refinery")),
        ("gas", ("lng", "lpg", "gas")),
        ("metals", ("copper", "nickel", "steel", "scrap")),
    ):
        if any(pattern in haystack for pattern in patterns):
            hints.append(label)
    return hints


def _license_type_for_subtype(subtype: str) -> str:
    return {
        "port": "Port",
        "terminal": "Port Terminal",
        "rail_terminal": "Rail Terminal",
        "logistics_hub": "Logistics Hub",
        "depot": "Depot",
    }.get(subtype, "Logistics Node")


def _default_commodity_label(subtype: str) -> str:
    if subtype in {"port", "terminal"}:
        return "General cargo"
    if subtype == "rail_terminal":
        return "General freight"
    return "Logistics"


def _entity_kind_for_subtype(subtype: str) -> str:
    if subtype in {"port", "terminal"}:
        return "port"
    return "logistics_node"


def _build_unlocode_record_url(locode: str) -> str:
    return f"{UNLOCODE_BROWSER_URL}?code={locode}"


def _normalize_unlocode_row(row: dict[str, Any], fetched_at: str) -> Optional[dict[str, Any]]:
    function_code = _clean_text(row.get("Function"))
    lat, lng = parse_unlocode_coordinates(_clean_text(row.get("Coordinates")))
    if lat is None or lng is None:
        return None

    country_iso2 = _clean_text(row.get("Country")).upper()
    location = _clean_text(row.get("Location")).upper()
    name = _clean_text(row.get("Name"))
    remarks = _clean_text(row.get("Remarks"))
    if not country_iso2 or not location or not name:
        return None

    subtype, confidence, confidence_note = _infer_subtype(function_code, name, remarks)
    if not subtype:
        return None

    locode = f"{country_iso2}{location}"
    country = _country_name_from_iso2(country_iso2)
    subdivision = _clean_text(row.get("Subdivision")) or None
    commodity_hints = _commodity_hints(name, remarks)

    nearby_port = None
    if subtype not in {"port", "terminal"}:
        nearest_ports = find_nearest_ports(country_iso2=country_iso2, lat=lat, lng=lng, limit=1)
        if nearest_ports:
            candidate = dict(nearest_ports[0])
            if candidate.get("distance_km") is not None and float(candidate["distance_km"]) <= MAX_NEARBY_PORT_DISTANCE_KM:
                nearby_port = candidate

    source_labels = ["UN/LOCODE"]
    if nearby_port:
        source_labels.append("Nearby UN/LOCODE port match")

    return {
        "id": f"unlocode:{locode}",
        "company": name,
        "licenseType": _license_type_for_subtype(subtype),
        "commodity": ", ".join(commodity_hints) if commodity_hints else _default_commodity_label(subtype),
        "status": "UN/LOCODE listed",
        "date": None,
        "country": country,
        "region": subdivision or country,
        "sector": "ports",
        "lat": lat,
        "lng": lng,
        "recordOrigin": "open_data",
        "sourceId": "unlocode_global_logistics",
        "sourceName": "UN/LOCODE",
        "sourceUrl": UNLOCODE_OFFICIAL_SOURCE_URL,
        "sourceRecordUrl": _build_unlocode_record_url(locode),
        "sourceUpdatedAt": fetched_at,
        "lastSyncedAt": fetched_at,
        "entityKind": _entity_kind_for_subtype(subtype),
        "entitySubtype": subtype,
        "operatorName": None,
        "sourceLabels": source_labels,
        "commodityHints": commodity_hints,
        "confidenceScore": round(confidence, 2),
        "confidenceNote": confidence_note,
        "nearbyPort": nearby_port,
        "locode": locode,
        "countryIso2": country_iso2,
        "subdivision": subdivision,
        "unlocodeStatus": _clean_text(row.get("Status")) or None,
    }


def _dedupe_entities(entities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for entity in entities:
        existing = deduped.get(entity["id"])
        if existing is None or float(entity.get("confidenceScore") or 0.0) > float(existing.get("confidenceScore") or 0.0):
            deduped[entity["id"]] = entity
    return list(deduped.values())


def _build_stats(entities: list[dict[str, Any]]) -> dict[str, Any]:
    countries = {entity["country"] for entity in entities if _clean_text(entity.get("country"))}
    by_subtype: dict[str, int] = {}
    by_country: dict[str, int] = {}
    ports_count = 0
    with_locode = 0
    with_nearby_port = 0
    high_confidence = 0

    for entity in entities:
        subtype = entity.get("entitySubtype") or "unknown"
        by_subtype[subtype] = by_subtype.get(subtype, 0) + 1
        country = entity.get("country") or "Unknown"
        by_country[country] = by_country.get(country, 0) + 1
        if entity.get("entityKind") == "port":
            ports_count += 1
        if entity.get("locode"):
            with_locode += 1
        if entity.get("nearbyPort"):
            with_nearby_port += 1
        if float(entity.get("confidenceScore") or 0.0) >= 0.9:
            high_confidence += 1

    top_countries = [
        {"country": country, "count": count}
        for country, count in sorted(by_country.items(), key=lambda item: (-item[1], item[0]))[:10]
    ]
    return {
        "total": len(entities),
        "countries": len(countries),
        "ports": ports_count,
        "with_locode": with_locode,
        "with_nearby_port": with_nearby_port,
        "high_confidence": high_confidence,
        "by_subtype": by_subtype,
        "top_countries": top_countries,
        "map_render_limit": MAP_RENDER_LIMIT,
    }


def _fresh_list_cache() -> Optional[dict[str, Any]]:
    age = time.time() - float(_list_cache.get("loaded_at") or 0.0)
    if _list_cache.get("response") and age < LIST_CACHE_TTL_SECONDS:
        return dict(_list_cache["response"])
    return None


def get_port_logistics_entities(force_refresh: bool = False) -> dict[str, Any]:
    if not force_refresh:
        cached = _fresh_list_cache()
        if cached is not None:
            cached["cached"] = True
            return cached

    fetched_at = _now_iso()
    warnings: list[str] = []
    rows: list[dict[str, Any]] = []

    try:
        csv_text = _fetch_text(UNLOCODE_CSV_URL)
        reader = csv.DictReader(io.StringIO(csv_text))
        for raw_row in reader:
            normalized = _normalize_unlocode_row(raw_row, fetched_at)
            if normalized:
                rows.append(normalized)
    except Exception as exc:
        warnings.append(f"UN/LOCODE fetch failed: {exc}")

    entities = _dedupe_entities(rows)
    entities.sort(
        key=lambda item: (
            0 if item.get("entityKind") == "port" else 1,
            -(float(item.get("confidenceScore") or 0.0)),
            _clean_text(item.get("country")),
            _clean_text(item.get("company")),
        )
    )

    response = {
        "entities": entities,
        "source_labels": ["UN/LOCODE", "OpenStreetMap", "GDELT DOC 2.0"],
        "data_as_of": fetched_at,
        "coverage_note": (
            "Global port coverage is anchored to official UN/LOCODE trade locations. Detail views enrich selected nodes with nearby "
            "OpenStreetMap infrastructure and open news evidence, but this does not claim berth-level or operator-complete global coverage."
        ),
        "limitations": [
            "The global backbone is UN/LOCODE, which covers trade and transport locations but is not a complete registry of every berth, quay, or private terminal.",
            "Non-port logistics nodes are only included when the official location name/remarks explicitly indicate a freight-facing terminal, depot, or logistics site.",
            "OpenStreetMap infrastructure links appear in detail views as nearby context, not as proof that the mapped feature is formally part of the same legal facility.",
            f"The map intentionally renders only the first {MAP_RENDER_LIMIT} filtered nodes at once for performance; search and filters narrow the visible set without shrinking the full dataset.",
        ]
        + warnings,
        "stats": _build_stats(entities),
    }

    _list_cache["loaded_at"] = time.time()
    _list_cache["response"] = response
    return dict(response)


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value in (None, "", "null"):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _build_osm_object_url(element_type: str, osm_id: int) -> str:
    return f"https://www.openstreetmap.org/{element_type}/{osm_id}"


def _build_nearby_infra_query(lat: float, lng: float, radius_m: int = NEARBY_INFRA_RADIUS_METERS) -> str:
    return f"""
[out:json][timeout:30];
(
  nwr(around:{radius_m},{lat},{lng})["industrial"="port"];
  nwr(around:{radius_m},{lat},{lng})["industrial"="logistics"];
  nwr(around:{radius_m},{lat},{lng})["railway"="terminal"];
  nwr(around:{radius_m},{lat},{lng})["man_made"="quay"];
  nwr(around:{radius_m},{lat},{lng})["cargo"];
);
out center tags qt;
""".strip()


def _infrastructure_kind(tags: dict[str, Any]) -> tuple[str, str]:
    if _clean_text(tags.get("man_made")) == "quay":
        return "quay", "Quay"
    if _clean_text(tags.get("railway")) == "terminal":
        return "rail_terminal", "Rail Terminal"
    industrial = _clean_text(tags.get("industrial"))
    if industrial == "port":
        return "port_area", "Port Area"
    if industrial == "logistics":
        return "logistics_hub", "Logistics Hub"
    cargo = _clean_text(tags.get("cargo"))
    if cargo:
        return "cargo_site", "Cargo Site"
    return "mapped_infrastructure", "Mapped Infrastructure"


def _display_infrastructure_name(tags: dict[str, Any], label: str) -> str:
    name = _clean_text(tags.get("name"))
    if name:
        return name
    operator = _clean_text(tags.get("operator"))
    if operator:
        return f"{operator} {label}"
    return f"Unnamed {label}"


def _summarize_infrastructure(tags: dict[str, Any], label: str) -> str:
    parts: list[str] = []
    cargo = _clean_text(tags.get("cargo"))
    operator = _clean_text(tags.get("operator"))
    if cargo:
        parts.append(f"cargo={cargo}")
    if operator:
        parts.append(f"operator={operator}")
    industrial = _clean_text(tags.get("industrial"))
    railway = _clean_text(tags.get("railway"))
    if industrial and industrial not in {"port", "logistics"}:
        parts.append(f"industrial={industrial}")
    if railway and railway != "terminal":
        parts.append(f"railway={railway}")
    return ", ".join(parts) if parts else f"Nearby OSM-mapped {label.lower()}."


def _normalize_nearby_infrastructure(element: dict[str, Any], lat: float, lng: float) -> Optional[dict[str, Any]]:
    tags = element.get("tags") or {}
    obj_lat = _safe_float(element.get("lat"))
    obj_lng = _safe_float(element.get("lon"))
    if obj_lat is None or obj_lng is None:
        center = element.get("center") or {}
        obj_lat = _safe_float(center.get("lat"))
        obj_lng = _safe_float(center.get("lon"))
    if obj_lat is None or obj_lng is None:
        return None

    subtype, label = _infrastructure_kind(tags)
    name = _display_infrastructure_name(tags, label)
    distance_km = round(haversine_km(lat, lng, obj_lat, obj_lng), 1)
    osm_type = _clean_text(element.get("type")) or "node"
    osm_id = int(element.get("id"))
    return {
        "id": f"osm:{osm_type}:{osm_id}",
        "label": name,
        "kind": subtype,
        "distance_km": distance_km,
        "source_label": "OpenStreetMap",
        "url": _build_osm_object_url(osm_type, osm_id),
        "operator": _clean_text(tags.get("operator")) or None,
        "cargo": _clean_text(tags.get("cargo")) or None,
        "summary": _summarize_infrastructure(tags, label),
    }


def _dedupe_infrastructure(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for item in items:
        existing = deduped.get(item["id"])
        if existing is None or float(item.get("distance_km") or 0.0) < float(existing.get("distance_km") or 1e9):
            deduped[item["id"]] = item
    return sorted(deduped.values(), key=lambda item: (float(item.get("distance_km") or 1e9), item["label"]))


def fetch_nearby_infrastructure(lat: float, lng: float) -> list[dict[str, Any]]:
    payload = _fetch_overpass_json(_build_nearby_infra_query(lat, lng))
    elements = payload.get("elements", []) if isinstance(payload, dict) else []
    normalized: list[dict[str, Any]] = []
    for element in elements:
        item = _normalize_nearby_infrastructure(element, lat, lng)
        if item:
            normalized.append(item)
    return _dedupe_infrastructure(normalized)[:10]


def _logistics_evidence_type(title: str) -> str:
    normalized = _normalize_token(title)
    if any(term in normalized for term in ("strike", "congestion", "backlog", "closure", "shutdown", "disruption", "delay")):
        return "disruption_signal"
    if any(term in normalized for term in ("attack", "fire", "explosion", "spill", "collision", "detained", "sanction")):
        return "risk_signal"
    if any(term in normalized for term in ("expansion", "upgrade", "investment", "construction", "capacity")):
        return "capacity_signal"
    return "logistics_context"


def fetch_logistics_evidence(
    *,
    name: str,
    country: str,
    subtype: str,
    locode: str = "",
    limit: int = 6,
) -> list[dict[str, Any]]:
    anchor = f'"{name}"'
    subtype_terms = (
        "(port OR berth OR quay OR terminal OR cargo OR shipping OR congestion OR strike OR disruption OR incident)"
        if subtype in {"port", "terminal"}
        else "(rail OR terminal OR depot OR logistics OR cargo OR congestion OR strike OR disruption OR incident)"
    )
    tokens = [anchor, subtype_terms]
    if country:
        tokens.append(f'"{country}"')
    if locode:
        tokens.append(f'"{locode}"')
    query = " ".join(tokens).strip()
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

    evidence: list[dict[str, Any]] = []
    for index, article in enumerate(articles):
        title = _clean_text(article.get("title")) or "Untitled article"
        url = _clean_text(article.get("url"))
        evidence.append(
            {
                "id": f"gdelt-logistics-{index}-{hash(url or title) & 0xfffffff}",
                "title": title,
                "url": url or None,
                "source_label": "GDELT DOC 2.0",
                "evidence_type": _logistics_evidence_type(title),
                "confidence": 0.58,
                "summary": title,
                "seen_at": _clean_text(article.get("seendate")) or None,
            }
        )
    return evidence


def _base_evidence(entity: dict[str, Any]) -> list[dict[str, Any]]:
    locode = entity.get("locode")
    evidence = [
        {
            "id": f"{entity['id']}:unlocode",
            "title": f"UN/LOCODE listed: {locode or entity['company']}",
            "url": entity.get("sourceRecordUrl") or entity.get("sourceUrl"),
            "source_label": "UN/LOCODE",
            "evidence_type": "official_registry",
            "confidence": float(entity.get("confidenceScore") or 0.0),
            "summary": entity.get("confidenceNote") or "Official UN/LOCODE trade-location record.",
            "seen_at": entity.get("sourceUpdatedAt"),
        }
    ]
    nearby_port = entity.get("nearbyPort")
    if nearby_port:
        evidence.append(
            {
                "id": f"{entity['id']}:nearby-port",
                "title": f"Nearest maritime port context: {nearby_port.get('name')}",
                "url": nearby_port.get("source_url"),
                "source_label": nearby_port.get("source_label") or "UN/LOCODE",
                "evidence_type": "nearby_port",
                "confidence": float(nearby_port.get("confidence") or 0.0),
                "summary": (
                    f"{nearby_port.get('name')} is {nearby_port.get('distance_km')} km away."
                    if nearby_port.get("distance_km") is not None
                    else "Nearby port context inferred from the UN/LOCODE registry."
                ),
                "seen_at": entity.get("sourceUpdatedAt"),
            }
        )
    return evidence


def _detail_limitations(subtype: str) -> list[str]:
    limitations = [
        "UN/LOCODE is a strong global trade-location backbone, but it does not provide complete operator, berth, throughput, or ownership coverage.",
        "Nearby OpenStreetMap features are proximity-based logistics context and may reflect a wider port district rather than a confirmed one-to-one facility match.",
        "GDELT evidence is news-derived screening context. It helps triage disruptions and incidents, but it is not official port-authority confirmation.",
    ]
    if subtype not in {"port", "terminal"}:
        limitations.append(
            "This non-port logistics node is included because the official UN/LOCODE record explicitly reads like a freight facility; many generic inland locations are intentionally excluded."
        )
    return limitations


def get_port_logistics_details(entity_id: str) -> Optional[dict[str, Any]]:
    cached = _detail_cache.get(entity_id)
    if cached and time.time() - float(cached.get("loaded_at") or 0.0) < DETAIL_CACHE_TTL_SECONDS:
        detail = dict(cached["detail"])
        detail["cached"] = True
        return detail

    response = get_port_logistics_entities(force_refresh=False)
    entity = next((item for item in response.get("entities", []) if item.get("id") == entity_id), None)
    if entity is None:
        return None

    detail = dict(entity)
    detail["dataAsOf"] = _now_iso()
    detail["coverageNote"] = response.get("coverage_note")
    detail["limitations"] = _detail_limitations(detail.get("entitySubtype") or "")
    detail["rawPayload"] = {
        "locode": detail.get("locode"),
        "country_iso2": detail.get("countryIso2"),
        "subdivision": detail.get("subdivision"),
        "unlocode_status": detail.get("unlocodeStatus"),
    }

    evidence = _base_evidence(detail)
    nearby_infrastructure: list[dict[str, Any]] = []

    try:
        nearby_infrastructure = fetch_nearby_infrastructure(float(detail["lat"]), float(detail["lng"]))
        if nearby_infrastructure:
            detail["sourceLabels"] = sorted(set((detail.get("sourceLabels") or []) + ["OpenStreetMap"]))
            for item in nearby_infrastructure[:6]:
                evidence.append(
                    {
                        "id": f"{item['id']}:context",
                        "title": item["label"],
                        "url": item.get("url"),
                        "source_label": item.get("source_label") or "OpenStreetMap",
                        "evidence_type": item.get("kind") or "mapped_infrastructure",
                        "confidence": 0.55,
                        "summary": item.get("summary"),
                        "seen_at": detail.get("sourceUpdatedAt"),
                    }
                )
    except Exception as exc:
        detail["limitations"].append(f"Nearby OSM infrastructure lookup failed: {exc}")

    try:
        logistics_evidence = fetch_logistics_evidence(
            name=detail["company"],
            country=detail["country"],
            subtype=detail.get("entitySubtype") or "",
            locode=detail.get("locode") or "",
        )
        if logistics_evidence:
            detail["sourceLabels"] = sorted(set((detail.get("sourceLabels") or []) + ["GDELT DOC 2.0"]))
            evidence.extend(logistics_evidence)
    except Exception as exc:
        detail["limitations"].append(f"Open disruption evidence lookup failed: {exc}")

    detail["nearbyInfrastructure"] = nearby_infrastructure
    detail["evidence"] = evidence
    detail["evidenceCount"] = len(evidence)

    _detail_cache[entity_id] = {
        "loaded_at": time.time(),
        "detail": detail,
    }
    return dict(detail)
