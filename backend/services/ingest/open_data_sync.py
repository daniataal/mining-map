from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    from backend.services.entity_contacts import sync_license_contacts_for_row
except ImportError:
    from services.entity_contacts import sync_license_contacts_for_row


BACKEND_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_USER_AGENT = os.getenv(
    "OPEN_DATA_SYNC_USER_AGENT",
    "mining-map-open-data-sync/1.0 (+https://cursor.sh)",
)


def _clean_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = " ".join(value.split())
        return cleaned or None
    cleaned = str(value).strip()
    return cleaned or None


def _coalesce(attrs: dict[str, Any], field_names: Iterable[str]) -> Optional[str]:
    for field_name in field_names:
        value = _clean_text(attrs.get(field_name))
        if value:
            return value
    return None


def _normalize_date(value: Any) -> Optional[datetime]:
    if value in (None, "", " "):
        return None
    if isinstance(value, (int, float)):
        seconds = float(value)
        if seconds > 1_000_000_000_000:
            seconds /= 1000.0
        try:
            return datetime.fromtimestamp(seconds, tz=timezone.utc).replace(tzinfo=None)
        except (OverflowError, OSError, ValueError):
            return None
    raw = _clean_text(value)
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _flatten_pairs(node: Any, points: list[tuple[float, float]]) -> None:
    if isinstance(node, (list, tuple)):
        if len(node) >= 2 and all(isinstance(v, (int, float)) for v in node[:2]):
            points.append((float(node[0]), float(node[1])))
            return
        for child in node:
            _flatten_pairs(child, points)


def arcgis_geometry_centroid(geometry: Optional[dict[str, Any]]) -> tuple[Optional[float], Optional[float]]:
    if not geometry:
        return None, None
    if isinstance(geometry.get("x"), (int, float)) and isinstance(geometry.get("y"), (int, float)):
        return float(geometry["y"]), float(geometry["x"])

    points: list[tuple[float, float]] = []
    for key in ("rings", "paths", "points"):
        if key in geometry:
            _flatten_pairs(geometry[key], points)
    if not points:
        return None, None

    xs = [pt[0] for pt in points]
    ys = [pt[1] for pt in points]
    return sum(ys) / len(ys), sum(xs) / len(xs)


def _join_parts(*parts: Any) -> str:
    seen: set[str] = set()
    ordered: list[str] = []
    for part in parts:
        cleaned = _clean_text(part)
        if not cleaned:
            continue
        lowered = cleaned.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        ordered.append(cleaned)
    return " | ".join(ordered)


def _build_source_record_url(layer_url: str, external_ref: str) -> str:
    return f"{layer_url}?record={external_ref}"


def _blm_mining_region(attrs: dict[str, Any]) -> str:
    case_number = _clean_text(attrs.get("CSE_NR")) or ""
    state_code = case_number[:2].strip().upper() if len(case_number) >= 2 else ""
    if state_code:
        return state_code
    return _clean_text(attrs.get("CSE_META")) or "United States"


def _blm_oil_region(attrs: dict[str, Any]) -> str:
    return _join_parts(attrs.get("ADMIN_STATE"), attrs.get("GEO_STATE"))


def _landfolio_region(attrs: dict[str, Any]) -> str:
    return _join_parts(attrs.get("Region"), attrs.get("MapRef"))


def _south_africa_region(prefix: str) -> Callable[[dict[str, Any]], str]:
    def builder(attrs: dict[str, Any]) -> str:
        return _join_parts(
            attrs.get(f"{prefix}.prov_cd"),
            attrs.get(f"{prefix}.Basin"),
            attrs.get(f"{prefix}.basin"),
            attrs.get(f"{prefix}.plot_desc"),
        )

    return builder


def _zambia_petroleum_region(attrs: dict[str, Any]) -> str:
    return _join_parts(
        f"Block {attrs.get('Block_No')}" if attrs.get("Block_No") is not None else None,
        attrs.get("Company"),
    )


@dataclass(frozen=True)
class ArcGISOpenDataSource:
    source_id: str
    source_name: str
    layer_url: str
    sector: str
    country: str
    external_id_fields: tuple[str, ...]
    company_fields: tuple[str, ...]
    commodity_fields: tuple[str, ...] = ()
    license_type_fields: tuple[str, ...] = ()
    status_fields: tuple[str, ...] = ()
    issued_fields: tuple[str, ...] = ()
    updated_fields: tuple[str, ...] = ()
    region_builder: Optional[Callable[[dict[str, Any]], str]] = None
    default_commodity: str = ""
    default_license_type: str = ""
    default_status: str = "Active"
    where: str = "1=1"
    order_by: Optional[str] = None
    max_records: Optional[int] = None
    page_size: int = 250
    request_pause_seconds: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)


def _landfolio_mining_source(
    *,
    source_id: str,
    source_name: str,
    layer_url: str,
    country: str,
    metadata: Optional[dict[str, Any]] = None,
    max_records: Optional[int] = None,
    order_by: Optional[str] = "DteGranted DESC",
    default_status: str = "Active",
) -> ArcGISOpenDataSource:
    return ArcGISOpenDataSource(
        source_id=source_id,
        source_name=source_name,
        layer_url=layer_url,
        sector="mining",
        country=country,
        external_id_fields=("guidShape", "guidLicense", "Code", "ESRI_OID"),
        company_fields=("Parties", "Name", "Code"),
        commodity_fields=("Commodities",),
        license_type_fields=("Type",),
        status_fields=("Status",),
        issued_fields=("DteGranted", "DteApplied"),
        updated_fields=("DteGranted", "DteApplied"),
        region_builder=_landfolio_region,
        default_commodity="Minerals",
        default_license_type="Mining Licence",
        default_status=default_status,
        order_by=order_by,
        max_records=max_records,
        page_size=250,
        metadata=metadata or {},
    )


def _zambia_mining_sources() -> tuple[ArcGISOpenDataSource, ...]:
    base = "https://ags1.landfolio.com/arcgis/rest/services/ZambiaMapPortal/Active/MapServer"
    layers = [
        (0, "Small Scale Exploration Licences"),
        (1, "Large Scale Exploration Licences"),
        (2, "Large Scale Mining Licences"),
        (3, "Small Scale Mining Licences"),
        (4, "Artisanal Mining Rights"),
        (5, "Mineral Processing Licences"),
        (6, "Prospecting Permits (2008)"),
        (7, "Prospecting Licences (2008)"),
        (8, "Large Scale Gemstone Licences (2008)"),
    ]
    return tuple(
        _landfolio_mining_source(
            source_id=f"zambia_mining_{layer_id}",
            source_name=f"Zambia Cadastre - {layer_name}",
            layer_url=f"{base}/{layer_id}",
            country="Zambia",
            metadata={
                "kind": "official_arcgis_registry",
                "coverage": "africa",
                "layer_name": layer_name,
            },
        )
        for layer_id, layer_name in layers
    )


OPEN_DATA_SOURCES: tuple[ArcGISOpenDataSource, ...] = (
    _landfolio_mining_source(
        source_id="kenya_mining_cadastre",
        source_name="Kenya Mining Cadastre Portal",
        layer_url="https://portal.miningcadastre.go.ke/arcgis/rest/services/LandfolioSOEv2_0_7/MapServer/0",
        country="Kenya",
        max_records=1500,
        default_status="Application",
        metadata={"kind": "official_arcgis_registry", "coverage": "africa"},
    ),
    *_zambia_mining_sources(),
    ArcGISOpenDataSource(
        source_id="us_blm_mining_claims",
        source_name="US BLM MLRS Mining Claims (Not Closed)",
        layer_url="https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/MapServer/0",
        sector="mining",
        country="United States",
        external_id_fields=("ID", "CSE_NR", "OBJECTID"),
        company_fields=("CSE_NAME", "CSE_NR"),
        license_type_fields=("BLM_PROD",),
        status_fields=("CSE_DISP",),
        issued_fields=("Modified", "Created"),
        updated_fields=("Modified", "Created"),
        region_builder=_blm_mining_region,
        default_commodity="Locatable minerals",
        default_license_type="Mining claim",
        default_status="Active",
        order_by="Modified DESC",
        max_records=1500,
        page_size=250,
        metadata={
            "kind": "official_arcgis_registry",
            "coverage": "us",
            "note": "Capped for MVP because the live service contains hundreds of thousands of polygons.",
        },
    ),
    ArcGISOpenDataSource(
        source_id="us_blm_oil_gas_authorized",
        source_name="US BLM Oil & Gas Leases (Authorized)",
        layer_url="https://gis.blm.gov/nlsdb/rest/services/Fluid_Minerals/Oil_Gas_Leases_Case_Disp/MapServer/0",
        sector="oil_and_gas",
        country="United States",
        external_id_fields=("SF_ID", "CSE_NR", "OBJECTID"),
        company_fields=("CSE_NAME", "CSE_NR"),
        commodity_fields=("CMMDTY",),
        license_type_fields=("BLM_PROD",),
        status_fields=("CSE_DISP", "PRDCNG"),
        issued_fields=("EFF_DT", "SALE_DT"),
        updated_fields=("EFF_DT", "SALE_DT"),
        region_builder=_blm_oil_region,
        default_commodity="Oil & Gas",
        default_license_type="Oil & Gas Lease",
        default_status="Authorized",
        order_by="EFF_DT DESC",
        max_records=1500,
        page_size=250,
        metadata={
            "kind": "official_arcgis_registry",
            "coverage": "us",
            "note": "Capped for MVP because the live service contains tens of thousands of polygons.",
        },
    ),
    ArcGISOpenDataSource(
        source_id="zambia_petroleum_licenses",
        source_name="Zambia Petroleum Licences",
        layer_url="https://ags1.landfolio.com/arcgis/rest/services/ZambiaMapPortal/PetroleumLicences/MapServer/0",
        sector="oil_and_gas",
        country="Zambia",
        external_id_fields=("Licence_No", "OBJECTID", "Block_No"),
        company_fields=("Company", "Licence_No"),
        status_fields=("Status",),
        issued_fields=("Grant_Date",),
        updated_fields=("Renewal_Da",),
        region_builder=_zambia_petroleum_region,
        default_commodity="Oil & Gas",
        default_license_type="Petroleum Licence",
        default_status="Granted",
        page_size=100,
        metadata={"kind": "official_arcgis_registry", "coverage": "africa"},
    ),
    ArcGISOpenDataSource(
        source_id="south_africa_onshore_petroleum",
        source_name="South Africa Petroleum Agency Onshore Rights",
        layer_url="https://geoportal.petroleumagencysa.com/arcgis/rest/services/Landfolio/Admin_and_Cadastral/MapServer/6",
        sector="oil_and_gas",
        country="South Africa",
        external_id_fields=(
            "Storefront.LDR.FSD_ONSHORE_LEASE_V.OBJECTID",
            "Storefront.LDR.FSD_ONSHORE_LEASE_V.poly_digital_ref",
        ),
        company_fields=(
            "Storefront.LDR.FSD_ONSHORE_LEASE_V.operator",
            "Storefront.LDR.FSD_ONSHORE_LEASE_V.poly_digital_ref",
        ),
        commodity_fields=("Storefront.LDR.FSD_ONSHORE_LEASE_V.product_rgts",),
        license_type_fields=("Storefront.LDR.FSD_ONSHORE_LEASE_V.ref_id",),
        status_fields=("STOREFRONT.LDR.LEASE_STATUS.DESCRIPTION",),
        issued_fields=("Storefront.LDR.FSD_ONSHORE_LEASE_V.lease_acqn_dte",),
        updated_fields=("Storefront.LDR.FSD_ONSHORE_LEASE_V.last_edited_date",),
        region_builder=_south_africa_region("Storefront.LDR.FSD_ONSHORE_LEASE_V"),
        default_commodity="Petroleum & natural gas",
        default_license_type="Onshore petroleum right",
        default_status="Active",
        page_size=100,
        metadata={"kind": "official_arcgis_registry", "coverage": "africa"},
    ),
    ArcGISOpenDataSource(
        source_id="south_africa_offshore_petroleum",
        source_name="South Africa Petroleum Agency Offshore Rights",
        layer_url="https://geoportal.petroleumagencysa.com/arcgis/rest/services/Landfolio/Admin_and_Cadastral/MapServer/7",
        sector="oil_and_gas",
        country="South Africa",
        external_id_fields=(
            "Storefront.LDR.FSD_LEASE_V.OBJECTID",
            "Storefront.LDR.FSD_LEASE_V.poly_digital_ref",
        ),
        company_fields=(
            "Storefront.LDR.FSD_LEASE_V.operator",
            "Storefront.LDR.FSD_LEASE_V.poly_digital_ref",
        ),
        license_type_fields=("Storefront.LDR.FSD_LEASE_V.ref_id",),
        status_fields=("STOREFRONT.LDR.LEASE_STATUS.DESCRIPTION",),
        issued_fields=("Storefront.LDR.FSD_LEASE_V.lease_acqn_dte",),
        updated_fields=("Storefront.LDR.FSD_LEASE_V.last_edited_date",),
        region_builder=_south_africa_region("Storefront.LDR.FSD_LEASE_V"),
        default_commodity="Petroleum & natural gas",
        default_license_type="Offshore petroleum right",
        default_status="Active",
        page_size=100,
        metadata={"kind": "official_arcgis_registry", "coverage": "africa"},
    ),
)


AFRICAN_COUNTRIES: tuple[tuple[str, str], ...] = (
    ("DZ", "Algeria"),
    ("AO", "Angola"),
    ("BJ", "Benin"),
    ("BW", "Botswana"),
    ("BF", "Burkina Faso"),
    ("BI", "Burundi"),
    ("CV", "Cabo Verde"),
    ("CM", "Cameroon"),
    ("CF", "Central African Republic"),
    ("TD", "Chad"),
    ("KM", "Comoros"),
    ("CG", "Republic of the Congo"),
    ("CD", "Democratic Republic of the Congo"),
    ("CI", "Cote d'Ivoire"),
    ("DJ", "Djibouti"),
    ("EG", "Egypt"),
    ("GQ", "Equatorial Guinea"),
    ("ER", "Eritrea"),
    ("SZ", "Eswatini"),
    ("ET", "Ethiopia"),
    ("GA", "Gabon"),
    ("GM", "Gambia"),
    ("GH", "Ghana"),
    ("GN", "Guinea"),
    ("GW", "Guinea-Bissau"),
    ("KE", "Kenya"),
    ("LS", "Lesotho"),
    ("LR", "Liberia"),
    ("LY", "Libya"),
    ("MG", "Madagascar"),
    ("MW", "Malawi"),
    ("ML", "Mali"),
    ("MR", "Mauritania"),
    ("MU", "Mauritius"),
    ("MA", "Morocco"),
    ("MZ", "Mozambique"),
    ("NA", "Namibia"),
    ("NE", "Niger"),
    ("NG", "Nigeria"),
    ("RW", "Rwanda"),
    ("ST", "Sao Tome and Principe"),
    ("SN", "Senegal"),
    ("SC", "Seychelles"),
    ("SL", "Sierra Leone"),
    ("SO", "Somalia"),
    ("ZA", "South Africa"),
    ("SS", "South Sudan"),
    ("SD", "Sudan"),
    ("TZ", "Tanzania"),
    ("TG", "Togo"),
    ("TN", "Tunisia"),
    ("UG", "Uganda"),
    ("ZM", "Zambia"),
    ("ZW", "Zimbabwe"),
)


AFRICA_COVERAGE_OVERRIDES: dict[str, dict[str, dict[str, Any]]] = {
    "Botswana": {
        "mining": {
            "status": "official_portal_only",
            "note": "Official mining cadastre portal exists, but no public queryable licence layer was discovered in the open ArcGIS directory.",
            "references": [
                {
                    "name": "Botswana Mining Cadastre Portal",
                    "url": "https://portal.miningcadastre.gov.bw/",
                    "access": "official_portal_only",
                }
            ],
        }
    },
    "Ghana": {
        "mining": {
            "status": "official_portal_only",
            "note": "Official mining cadastre repository is public, but a stable machine-readable licence API was not verified in this pass.",
            "references": [
                {
                    "name": "Ghana Mining Cadastre Repository",
                    "url": "https://ghana.revenuedev.org/",
                    "access": "official_portal_only",
                }
            ],
        }
    },
    "Liberia": {
        "mining": {
            "status": "decommissioned",
            "note": "The previously public Landfolio concessions portal reports that it was decommissioned in December 2025.",
            "references": [
                {
                    "name": "Liberia Landfolio Portal",
                    "url": "https://portals.landfolio.com/Liberia/",
                    "access": "decommissioned",
                }
            ],
        }
    },
    "Mauritania": {
        "mining": {
            "status": "official_api_restricted",
            "note": "Official mining cadastre ArcGIS services are discoverable from the public portal, but direct feature access currently returns token-required responses.",
            "references": [
                {
                    "name": "Mauritania Cadastre Portal",
                    "url": "https://portals.landfolio.com/mauritania/fr/",
                    "access": "token_required",
                }
            ],
        }
    },
    "Mozambique": {
        "mining": {
            "status": "official_api_restricted",
            "note": "INAMI ArcGIS licensing services are visible but require an ArcGIS token for direct access.",
            "references": [
                {
                    "name": "Mozambique INAMI Licenses",
                    "url": "https://licenses.inami.gov.mz/arcgis/rest/services",
                    "access": "token_required",
                }
            ],
        },
        "oil_and_gas": {
            "status": "official_api_restricted",
            "note": "The official Hydrocarbons ArcGIS service is visible in the public portal but requires a token for direct access.",
            "references": [
                {
                    "name": "Mozambique INAMI Hydrocarbons",
                    "url": "https://licenses.inami.gov.mz/arcgis/rest/services/MapPortal/Hydrocarbons/MapServer",
                    "access": "token_required",
                }
            ],
        },
    },
    "Namibia": {
        "mining": {
            "status": "official_api_restricted",
            "note": "Official active mining FeatureServer endpoints are embedded in the public portal, but direct feature access currently requires a token.",
            "references": [
                {
                    "name": "Namibia Active Mining Layer",
                    "url": "https://services1.arcgis.com/AYIukXzftCPbklHN/arcgis/rest/services/NamibiaPortal_ActiveMiningLayer_1/FeatureServer",
                    "access": "token_required",
                }
            ],
        },
        "oil_and_gas": {
            "status": "official_api_restricted",
            "note": "Official active petroleum FeatureServer endpoints are embedded in the public portal, but direct feature access currently requires a token.",
            "references": [
                {
                    "name": "Namibia Active Petroleum Layer",
                    "url": "https://services1.arcgis.com/AYIukXzftCPbklHN/arcgis/rest/services/NamibiaPortal_ActivePetroleumLayer_1/FeatureServer",
                    "access": "token_required",
                }
            ],
        },
    },
    "South Africa": {
        "mining": {
            "status": "official_portal_only",
            "note": "SAMRAD and the Mining Licensing System are official DMRE mining-rights portals, but a stable open machine-readable mining layer was not verified in this pass.",
            "references": [
                {
                    "name": "SAMRAD Online",
                    "url": "https://portal-samradonline.dmre.gov.za/",
                    "access": "official_portal_only",
                },
                {
                    "name": "South Africa Mining Licensing System",
                    "url": "https://mininglicense.dmpr.gov.za/indwe/splash.html",
                    "access": "official_portal_only",
                },
            ],
        }
    },
    "Sierra Leone": {
        "mining": {
            "status": "official_portal_only",
            "note": "The National Minerals Agency repository is public, but a stable machine-readable licence endpoint was not verified in this pass.",
            "references": [
                {
                    "name": "Sierra Leone Repository",
                    "url": "https://sierraleone.revenuedev.org/",
                    "access": "official_portal_only",
                }
            ],
        }
    },
    "South Sudan": {
        "oil_and_gas": {
            "status": "official_portal_only",
            "note": "The Ministry of Petroleum publishes an official open-blocks page with GIS/download references, but we did not identify a stable direct API/feature service during this pass.",
            "references": [
                {
                    "name": "South Sudan Open Blocks",
                    "url": "https://www.mop.gov.ss/open-blocks",
                    "access": "official_download_page",
                }
            ],
        }
    },
    "Uganda": {
        "mining": {
            "status": "official_portal_only",
            "note": "An official Uganda mining cadastre portal exists, but no public machine-readable layer endpoint was verified in this pass.",
            "references": [
                {
                    "name": "Uganda Mining Cadastre Portal",
                    "url": "https://portals.landfolio.com/uganda/",
                    "access": "official_portal_only",
                }
            ],
        },
        "oil_and_gas": {
            "status": "official_portal_only",
            "note": "PAU publishes an official maps portal for petroleum information, but we did not verify an open licence/block feature service in this pass.",
            "references": [
                {
                    "name": "PAU Maps",
                    "url": "https://paumaps.pau.go.ug/portal/home/",
                    "access": "official_portal_only",
                }
            ],
        },
    },
}


def _fetch_json(url: str, retries: int = 3, pause_seconds: float = 1.0) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(retries):
        req = Request(url, headers={"User-Agent": DEFAULT_USER_AGENT})
        try:
            with urlopen(req, timeout=30) as response:
                return json.load(response)
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            last_error = exc
            if attempt < retries - 1:
                time.sleep(pause_seconds)
    if last_error is None:
        raise RuntimeError(f"Failed to fetch JSON from {url}")
    raise RuntimeError(f"Failed to fetch JSON from {url}: {last_error}") from last_error


def fetch_arcgis_features(source: ArcGISOpenDataSource) -> list[dict[str, Any]]:
    all_features: list[dict[str, Any]] = []
    offset = 0
    while True:
        remaining = None
        if source.max_records is not None:
            remaining = source.max_records - len(all_features)
            if remaining <= 0:
                break
        batch_size = min(source.page_size, remaining) if remaining is not None else source.page_size
        params = {
            "where": source.where,
            "outFields": "*",
            "returnGeometry": "true",
            "f": "pjson",
            "outSR": "4326",
            "resultOffset": offset,
            "resultRecordCount": batch_size,
        }
        if source.order_by:
            params["orderByFields"] = source.order_by
        query_url = f"{source.layer_url}/query?{urlencode(params)}"
        payload = _fetch_json(query_url)
        if payload.get("error"):
            raise RuntimeError(f"{source.source_id} ArcGIS query failed: {payload['error']}")
        features = payload.get("features", [])
        if not features:
            break
        all_features.extend(features[:batch_size])
        offset += len(features)
        if not payload.get("exceededTransferLimit"):
            break
        if source.request_pause_seconds > 0:
            time.sleep(source.request_pause_seconds)
    return all_features


def normalize_feature(source: ArcGISOpenDataSource, feature: dict[str, Any]) -> dict[str, Any]:
    attrs = feature.get("attributes") or {}
    lat, lng = arcgis_geometry_centroid(feature.get("geometry"))

    external_ref = _coalesce(attrs, source.external_id_fields)
    if not external_ref:
        digest = hashlib.sha1(
            json.dumps(attrs, sort_keys=True, ensure_ascii=True, default=str).encode("utf-8")
        ).hexdigest()[:16]
        external_ref = digest

    company = _coalesce(attrs, source.company_fields) or external_ref
    commodity = _coalesce(attrs, source.commodity_fields) or source.default_commodity or source.sector.replace("_", " ").title()
    license_type = _coalesce(attrs, source.license_type_fields) or source.default_license_type or "License"
    status = _coalesce(attrs, source.status_fields) or source.default_status or "Active"
    region = source.region_builder(attrs) if source.region_builder else ""
    issued_at = None
    for field_name in source.issued_fields:
        issued_at = _normalize_date(attrs.get(field_name))
        if issued_at is not None:
            break
    source_updated_at = None
    for field_name in source.updated_fields:
        source_updated_at = _normalize_date(attrs.get(field_name))
        if source_updated_at is not None:
            break

    return {
        "id": f"{source.source_id}:{external_ref}",
        "company": company,
        "country": source.country,
        "region": region,
        "commodity": commodity,
        "license_type": license_type,
        "status": status,
        "lat": lat,
        "lng": lng,
        "date_issued": issued_at,
        "sector": source.sector,
        "record_origin": "open_data",
        "source_id": source.source_id,
        "source_name": source.source_name,
        "source_url": source.layer_url,
        "source_record_url": _build_source_record_url(source.layer_url, external_ref),
        "source_updated_at": source_updated_at.isoformat() if source_updated_at else None,
        "raw_payload": json.dumps(attrs, ensure_ascii=True, sort_keys=True, default=str),
    }


def _dedupe_by_id(records: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for record in records:
        deduped[record["id"]] = record
    return list(deduped.values())


def _default_db_connection():
    import psycopg2

    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        return psycopg2.connect(database_url, connect_timeout=5)
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "mining_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "password"),
        connect_timeout=5,
    )


UPSERT_SQL = """
    INSERT INTO licenses (
        id, company, country, region, commodity, license_type, status, lat, lng,
        date_issued, sector, record_origin, source_id, source_name, source_url,
        source_record_url, source_updated_at, raw_payload, last_synced_at
    )
    VALUES (
        %s, %s, %s, %s, %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s, %s,
        %s, %s, %s, CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO UPDATE SET
        company = EXCLUDED.company,
        country = EXCLUDED.country,
        region = EXCLUDED.region,
        commodity = EXCLUDED.commodity,
        license_type = EXCLUDED.license_type,
        status = EXCLUDED.status,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        date_issued = EXCLUDED.date_issued,
        sector = EXCLUDED.sector,
        record_origin = EXCLUDED.record_origin,
        source_id = EXCLUDED.source_id,
        source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url,
        source_record_url = EXCLUDED.source_record_url,
        source_updated_at = EXCLUDED.source_updated_at,
        raw_payload = EXCLUDED.raw_payload,
        last_synced_at = CURRENT_TIMESTAMP;
"""


def upsert_open_data_records(conn: Any, records: Iterable[dict[str, Any]]) -> int:
    written = 0
    with conn.cursor() as cur:
        for record in records:
            cur.execute(
                UPSERT_SQL,
                (
                    record["id"],
                    record["company"],
                    record["country"],
                    record["region"],
                    record["commodity"],
                    record["license_type"],
                    record["status"],
                    record["lat"],
                    record["lng"],
                    record["date_issued"],
                    record["sector"],
                    record["record_origin"],
                    record["source_id"],
                    record["source_name"],
                    record["source_url"],
                    record["source_record_url"],
                    record["source_updated_at"],
                    record["raw_payload"],
                ),
            )
            sync_license_contacts_for_row(conn, record)
            written += 1
    conn.commit()
    return written


def mark_existing_bundled_rows(conn: Any) -> int:
    bundled_path = BACKEND_ROOT / "licenses.json"
    if not bundled_path.exists():
        return 0
    bundled = json.loads(bundled_path.read_text(encoding="utf-8"))
    bundled_ids = [item.get("id") for item in bundled if item.get("id")]
    if not bundled_ids:
        return 0

    updated = 0
    chunk_size = 250
    with conn.cursor() as cur:
        for idx in range(0, len(bundled_ids), chunk_size):
            chunk = bundled_ids[idx: idx + chunk_size]
            placeholders = ", ".join(["%s"] * len(chunk))
            cur.execute(
                f"""
                UPDATE licenses
                SET
                    record_origin = 'bundled_json',
                    sector = COALESCE(NULLIF(sector, ''), 'mining'),
                    source_id = 'bundled_json',
                    source_name = 'Bundled JSON fallback'
                WHERE id IN ({placeholders})
                  AND (
                    source_id IS NULL OR source_id = '' OR source_id = 'bundled_json'
                  )
                """,
                tuple(chunk),
            )
            updated += cur.rowcount
    conn.commit()
    return updated


def seed_bundled_json_fallback(conn: Any) -> int:
    bundled_path = BACKEND_ROOT / "licenses.json"
    if not bundled_path.exists():
        return 0

    records = []
    for item in json.loads(bundled_path.read_text(encoding="utf-8")):
        item_id = item.get("id")
        if not item_id:
            continue
        records.append(
            {
                "id": item_id,
                "company": item.get("company") or "Unknown License",
                "country": item.get("country") or "Unknown",
                "region": item.get("region") or "",
                "commodity": item.get("commodity") or "Minerals",
                "license_type": item.get("licenseType") or "Mining licence",
                "status": item.get("status") or "Active",
                "lat": item.get("lat"),
                "lng": item.get("lng"),
                "date_issued": _normalize_date(item.get("date")),
                "sector": item.get("sector") or "mining",
                "record_origin": "bundled_json",
                "source_id": "bundled_json",
                "source_name": "Bundled JSON fallback",
                "source_url": None,
                "source_record_url": None,
                "source_updated_at": None,
                "raw_payload": json.dumps(item, ensure_ascii=True, sort_keys=True, default=str),
            }
        )

    inserted = 0
    with conn.cursor() as cur:
        for record in records:
            cur.execute(
                """
                INSERT INTO licenses (
                    id, company, country, region, commodity, license_type, status, lat, lng,
                    date_issued, sector, record_origin, source_id, source_name, raw_payload, last_synced_at
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP
                )
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    record["id"],
                    record["company"],
                    record["country"],
                    record["region"],
                    record["commodity"],
                    record["license_type"],
                    record["status"],
                    record["lat"],
                    record["lng"],
                    record["date_issued"],
                    record["sector"],
                    record["record_origin"],
                    record["source_id"],
                    record["source_name"],
                    record["raw_payload"],
                ),
            )
            inserted += cur.rowcount
    conn.commit()
    return inserted


def sync_open_data_sources(
    conn: Any | None = None,
    source_ids: Optional[Iterable[str]] = None,
) -> dict[str, Any]:
    requested = set(source_ids or [])
    own_connection = conn is None
    if conn is None:
        conn = _default_db_connection()

    summary = {
        "sources": [],
        "records_fetched": 0,
        "records_written": 0,
        "bundled_rows_marked": 0,
        "errors": [],
    }

    try:
        summary["bundled_rows_marked"] = mark_existing_bundled_rows(conn)
        for source in OPEN_DATA_SOURCES:
            if requested and source.source_id not in requested:
                continue
            try:
                features = fetch_arcgis_features(source)
                records = _dedupe_by_id(normalize_feature(source, feature) for feature in features)
                written = upsert_open_data_records(conn, records)
                summary["records_fetched"] += len(features)
                summary["records_written"] += written
                summary["sources"].append(
                    {
                        "source_id": source.source_id,
                        "source_name": source.source_name,
                        "sector": source.sector,
                        "country": source.country,
                        "fetched": len(features),
                        "written": written,
                        "metadata": source.metadata,
                    }
                )
            except Exception as exc:
                summary["errors"].append(f"{source.source_id}: {exc}")
        return summary
    finally:
        if own_connection and conn is not None:
            conn.close()


def _query_record_origin_stats(conn: Any, record_origin: str) -> dict[tuple[str, str], dict[str, Any]]:
    stats: dict[tuple[str, str], dict[str, Any]] = {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                country,
                sector,
                COUNT(*) AS record_count,
                MAX(last_synced_at) AS last_synced_at,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT source_name), NULL) AS source_names
            FROM licenses
            WHERE record_origin = %s
            GROUP BY country, sector
            """,
            (record_origin,),
        )
        for country, sector, record_count, last_synced_at, source_names in cur.fetchall():
            stats[(country, sector)] = {
                "record_count": int(record_count or 0),
                "last_synced_at": last_synced_at.isoformat() if last_synced_at else None,
                "source_names": list(source_names or []),
            }
    return stats


def _build_syncable_africa_coverage() -> dict[tuple[str, str], dict[str, Any]]:
    coverage: dict[tuple[str, str], dict[str, Any]] = {}
    for source in OPEN_DATA_SOURCES:
        if source.metadata.get("coverage") != "africa":
            continue
        key = (source.country, source.sector)
        entry = coverage.setdefault(
            key,
            {
                "status": "official_syncable",
                "note": "Official machine-readable source is configured for live sync.",
                "references": [],
                "source_ids": [],
            },
        )
        entry["source_ids"].append(source.source_id)
        entry["references"].append(
            {
                "name": source.source_name,
                "url": source.layer_url,
                "access": "open_machine_readable",
            }
        )
    return coverage


def get_africa_coverage(conn: Any | None = None) -> dict[str, Any]:
    own_connection = conn is None
    if conn is None:
        conn = _default_db_connection()

    try:
        live_stats = _query_record_origin_stats(conn, "open_data")
        fallback_stats = _query_record_origin_stats(conn, "user_import_csv")
        syncable = _build_syncable_africa_coverage()
        countries: list[dict[str, Any]] = []
        summary: dict[str, dict[str, int]] = {
            "mining": {},
            "oil_and_gas": {},
        }

        for iso2, country in AFRICAN_COUNTRIES:
            sector_coverage: dict[str, dict[str, Any]] = {}
            overrides = AFRICA_COVERAGE_OVERRIDES.get(country, {})
            for sector in ("mining", "oil_and_gas"):
                base = {
                    "status": "unavailable",
                    "note": "No verified open official registry or portal was confirmed in the current research pass.",
                    "references": [],
                    "source_ids": [],
                    "record_count": 0,
                    "last_synced_at": None,
                    "fallback_record_count": 0,
                    "fallback_last_synced_at": None,
                    "fallback_sources": [],
                }

                derived = syncable.get((country, sector))
                if derived:
                    base.update(
                        {
                            "status": derived["status"],
                            "note": derived["note"],
                            "references": list(derived["references"]),
                            "source_ids": list(derived["source_ids"]),
                        }
                    )

                override = overrides.get(sector)
                if override:
                    base.update(override)
                    base["references"] = list(override.get("references", base["references"]))
                    base["source_ids"] = list(override.get("source_ids", base["source_ids"]))

                stat = live_stats.get((country, sector))
                if stat:
                    base["record_count"] = stat["record_count"]
                    base["last_synced_at"] = stat["last_synced_at"]

                summary_bucket = summary[sector]
                fallback = fallback_stats.get((country, sector))
                if fallback:
                    base["fallback_record_count"] = fallback["record_count"]
                    base["fallback_last_synced_at"] = fallback["last_synced_at"]
                    base["fallback_sources"] = fallback["source_names"]
                    summary_bucket["fallback_imported"] = summary_bucket.get("fallback_imported", 0) + 1

                summary_bucket[base["status"]] = summary_bucket.get(base["status"], 0) + 1
                sector_coverage[sector] = base

            countries.append(
                {
                    "country": country,
                    "iso2": iso2,
                    "sectors": sector_coverage,
                }
            )

        return {
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "summary": summary,
            "countries": countries,
        }
    finally:
        if own_connection and conn is not None:
            conn.close()


if __name__ == "__main__":
    result = sync_open_data_sources()
    print(json.dumps(result, indent=2, ensure_ascii=True, default=str))
