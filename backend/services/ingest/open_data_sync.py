from __future__ import annotations

import functools
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

try:
    from backend.services.entity_relationships import sync_license_relationships_for_row
except ImportError:
    from services.entity_relationships import sync_license_relationships_for_row


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


def _fixed_region(label: str) -> Callable[[dict[str, Any]], str]:
    def builder(_: dict[str, Any]) -> str:
        return label

    return builder


def _megagiant_region(attrs: dict[str, Any]) -> str:
    return _join_parts(attrs.get("STATE"), attrs.get("REG_NAME"))


def _norway_production_licence_region(attrs: dict[str, Any]) -> str:
    return _join_parts(
        attrs.get("prlMainArea"),
        attrs.get("prlPhaseCurrent"),
        attrs.get("prlStratigraphical"),
    )


def _queensland_mineral_tenement_region(attrs: dict[str, Any]) -> str:
    return _join_parts(attrs.get("tensymbol"), attrs.get("tentype"))


def _finland_mining_area_region(attrs: dict[str, Any]) -> str:
    return _join_parts(attrs.get("ALUEENNIMI"), attrs.get("ALUETUNNUS"))


def _resolve_country(source: "ArcGISOpenDataSource", attrs: dict[str, Any]) -> str:
    dynamic_country = _coalesce(attrs, source.country_fields)
    return dynamic_country or source.country


def _resolve_source_record_url(
    source: "ArcGISOpenDataSource",
    attrs: dict[str, Any],
    external_ref: str,
) -> Optional[str]:
    direct = _coalesce(attrs, source.source_record_url_fields)
    if direct:
        return direct
    if not source.layer_url:
        return None
    return _build_source_record_url(source.layer_url, external_ref)


def _source_summary_note(source: "ArcGISOpenDataSource") -> str:
    explicit = _clean_text(source.metadata.get("summary_note"))
    if explicit:
        return explicit

    jurisdiction_label = _clean_text(source.metadata.get("jurisdiction_label"))
    jurisdiction_scope = _clean_text(source.metadata.get("jurisdiction_scope")) or "country"
    if jurisdiction_scope == "subnational" and jurisdiction_label:
        return f"Official machine-readable source is configured for {jurisdiction_label} only."
    if jurisdiction_scope == "federal" and jurisdiction_label:
        return f"Official machine-readable source is configured for {jurisdiction_label}."
    return "Official machine-readable source is configured for live sync."


@dataclass(frozen=True)
class ArcGISOpenDataSource:
    source_id: str
    source_name: str
    layer_url: str
    sector: str
    country: str
    external_id_fields: tuple[str, ...]
    company_fields: tuple[str, ...]
    country_fields: tuple[str, ...] = ()
    commodity_fields: tuple[str, ...] = ()
    license_type_fields: tuple[str, ...] = ()
    status_fields: tuple[str, ...] = ()
    issued_fields: tuple[str, ...] = ()
    updated_fields: tuple[str, ...] = ()
    region_builder: Optional[Callable[[dict[str, Any]], str]] = None
    source_record_url_fields: tuple[str, ...] = ()
    default_commodity: str = ""
    default_license_type: str = ""
    default_status: str = "Active"
    record_origin: str = "open_data"
    where: str = "1=1"
    order_by: Optional[str] = None
    max_records: Optional[int] = None
    page_size: int = 250
    request_pause_seconds: float = 0.0
    sync_contacts: bool = True
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


def _new_zealand_petroleum_source() -> ArcGISOpenDataSource:
    return ArcGISOpenDataSource(
        source_id="new_zealand_petroleum_active_permits",
        source_name="New Zealand Petroleum Active Permits",
        layer_url="https://gis.nzpam.govt.nz/server/rest/services/Public/Permits_Petroleum_Layers/FeatureServer/1",
        sector="oil_and_gas",
        country="New Zealand",
        external_id_fields=("Permit_Number", "OBJECTID"),
        company_fields=("Operator", "Owners", "Permit_Number"),
        commodity_fields=("Minerals", "Commodity"),
        license_type_fields=("Permit_Type_Description", "Permit_Type_Code"),
        status_fields=("Permit_Status",),
        issued_fields=("Permit_Grant_Date", "Permit_Commencement_Date"),
        updated_fields=("Permit_Status_Date",),
        region_builder=lambda attrs: _join_parts(
            attrs.get("Permit_Location"),
            attrs.get("Permit_Offshore_Onshore"),
        ),
        default_commodity="Oil & Gas",
        default_license_type="Petroleum permit",
        default_status="Active",
        order_by="Permit_Status_Date DESC",
        page_size=500,
        metadata={
            "kind": "official_arcgis_registry",
            "coverage": "world",
            "summary_note": "Official machine-readable source is configured for New Zealand petroleum active permits.",
        },
    )


def _british_columbia_mining_source() -> ArcGISOpenDataSource:
    return ArcGISOpenDataSource(
        source_id="british_columbia_mineral_tenure",
        source_name="British Columbia Mineral Tenure",
        layer_url="https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/213",
        sector="mining",
        country="Canada",
        external_id_fields=("TENURE_NUMBER_ID", "OBJECTID"),
        company_fields=("OWNER_NAME", "CLAIM_NAME", "TENURE_NUMBER_ID"),
        license_type_fields=("TENURE_TYPE_DESCRIPTION",),
        issued_fields=("ISSUE_DATE",),
        updated_fields=("UPDATE_TIMESTAMP",),
        region_builder=_fixed_region("British Columbia"),
        default_commodity="Minerals",
        default_license_type="Mineral tenure",
        default_status="Active",
        order_by="UPDATE_TIMESTAMP DESC",
        max_records=5000,
        page_size=1000,
        metadata={
            "kind": "official_arcgis_registry",
            "coverage": "world",
            "jurisdiction_scope": "subnational",
            "jurisdiction_label": "British Columbia",
            "summary_note": "Official machine-readable source is configured for British Columbia mineral tenure only.",
            "note": "Capped for MVP because the live provincial tenure layer is large.",
        },
    )


def _canada_northern_oil_rights_source() -> ArcGISOpenDataSource:
    return ArcGISOpenDataSource(
        source_id="canada_northern_oil_gas_rights",
        source_name="Canada Northern Oil and Gas Rights",
        layer_url="https://services.sac-isc.gc.ca/geomatics/rest/services/Donnees_Ouvertes-Open_Data/Droits_petroliers_et_gaziers_Oil_and_Gas_Rights/FeatureServer/0",
        sector="oil_and_gas",
        country="Canada",
        external_id_fields=("LICENCE_NUMBER", "OBJECTID"),
        company_fields=("LICENCE_NUMBER",),
        license_type_fields=("AGRMT_TYPE_E",),
        issued_fields=("LICENCE_ISSUE_DATE",),
        region_builder=lambda attrs: _join_parts(attrs.get("REGION_E"), attrs.get("AGRMT_TYPE_E")),
        default_commodity="Oil & Gas",
        default_license_type="Oil & Gas Right",
        default_status="Current",
        page_size=500,
        metadata={
            "kind": "official_arcgis_registry",
            "coverage": "world",
            "jurisdiction_scope": "subnational",
            "jurisdiction_label": "Canada northern oil and gas rights areas",
            "summary_note": "Official machine-readable source is configured for Canada's northern oil and gas rights areas.",
        },
    )


def _usgs_mrds_global_source() -> ArcGISOpenDataSource:
    return ArcGISOpenDataSource(
        source_id="usgs_mrds_global",
        source_name="USGS Mineral Resources Data System (MRDS)",
        layer_url="https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/Mineral_Resources_Data_System_MRDS_Compact_Version/FeatureServer/0",
        sector="mining",
        country="Global",
        external_id_fields=("DEP_ID", "OBJECTID"),
        company_fields=("SITE_NAME", "DEP_ID"),
        country_fields=("COUNTRY",),
        commodity_fields=("CODE_LIST",),
        status_fields=("DEV_STAT",),
        source_record_url_fields=("URL",),
        default_commodity="Minerals",
        default_license_type="Mine / occurrence",
        default_status="Recorded site",
        record_origin="global_open_fallback",
        order_by="OBJECTID ASC",
        max_records=25000,
        page_size=2000,
        sync_contacts=False,
        metadata={
            "kind": "global_open_fallback",
            "coverage": "world",
            "summary_note": (
                "Open global mining site/deposit visibility from USGS MRDS. "
                "Not an official licence or concession registry."
            ),
            "note": (
                "MRDS remains a useful global mining fallback but USGS notes that systematic updates ceased after 2011. "
                "The live sync is capped for MVP volume."
            ),
        },
    )


def _norway_production_licences_current_source() -> ArcGISOpenDataSource:
    return ArcGISOpenDataSource(
        source_id="norway_npd_production_licences_current",
        source_name="Norwegian Offshore Directorate — Production licences (current, with geometry)",
        layer_url="https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/FeatureServer/616",
        sector="oil_and_gas",
        country="Norway",
        external_id_fields=("prlNpdidLicence", "OBJECTID"),
        company_fields=("cmpLongName", "prlName"),
        license_type_fields=("prlLicensingActivityName",),
        status_fields=("prlStatus",),
        issued_fields=("prlDateGranted",),
        updated_fields=("prlDateUpdatedMax", "prlDateUpdated", "prlDateLastChanged"),
        region_builder=_norway_production_licence_region,
        source_record_url_fields=("prlFactPageUrl", "prlFactMapUrl"),
        default_commodity="Oil & Gas",
        default_license_type="Production licence",
        default_status="Current",
        order_by="prlDateUpdatedMax DESC",
        max_records=2500,
        page_size=500,
        sync_contacts=False,
        metadata={
            "kind": "official_arcgis_registry",
            "coverage": "europe",
            "jurisdiction_scope": "country",
            "jurisdiction_label": "Norway",
            "summary_note": "Official Norwegian Offshore Directorate (NPD) Factmaps service for current production licences.",
        },
    )


def _finland_active_mining_areas_source() -> ArcGISOpenDataSource:
    return ArcGISOpenDataSource(
        source_id="finland_tukes_active_mining_areas",
        source_name="Finland Tukes — Active mining areas (Kaivosalueet voimassa)",
        layer_url="https://gtkdata.gtk.fi/arcgis/rest/services/Tukes/Kaivosrekisteri/MapServer/15",
        sector="mining",
        country="Finland",
        external_id_fields=("ALUETUNNUS", "OBJECTID"),
        company_fields=("HAKIJA", "ALUETUNNUS"),
        commodity_fields=("KIVENNAISET",),
        license_type_fields=("ALUESTATUS",),
        status_fields=("ALUESTATUS",),
        issued_fields=("PAATOSPVM",),
        updated_fields=("VOIMASSAOLOPVM", "SAAPUMISPVM"),
        region_builder=_finland_mining_area_region,
        default_commodity="Minerals",
        default_license_type="Mining area",
        default_status="Active",
        order_by="OBJECTID DESC",
        max_records=500,
        page_size=100,
        sync_contacts=False,
        metadata={
            "kind": "official_arcgis_registry",
            "coverage": "europe",
            "jurisdiction_scope": "country",
            "jurisdiction_label": "Finland",
            "summary_note": "Official Finnish mining safety authority (Tukes) register layer published via GTK spatial services.",
        },
    )


def _queensland_mineral_tenement_source() -> ArcGISOpenDataSource:
    return ArcGISOpenDataSource(
        source_id="australia_queensland_mineral_tenement",
        source_name="Queensland Government — Mineral and coal exploration / production authorities",
        layer_url="https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Economy/MineralTenement/FeatureServer/0",
        sector="mining",
        country="Australia",
        external_id_fields=("tenid", "objectid"),
        company_fields=("tenowner", "tenname", "tenid"),
        commodity_fields=("tenmineral",),
        license_type_fields=("tentype",),
        status_fields=("tenstatus",),
        issued_fields=("grantdate", "appdate"),
        updated_fields=("expiredate",),
        region_builder=_queensland_mineral_tenement_region,
        default_commodity="Minerals",
        default_license_type="Mineral / coal authority",
        default_status="Active",
        order_by="objectid DESC",
        max_records=4500,
        page_size=1000,
        sync_contacts=False,
        metadata={
            "kind": "official_arcgis_registry",
            "coverage": "asia_pacific",
            "jurisdiction_scope": "subnational",
            "jurisdiction_label": "Queensland, Australia",
            "summary_note": "Official Queensland spatial catalogue mineral and coal tenement layer (state-level, not whole-of-Australia).",
            "note": "Capped for performance; very large statewide tenure layer.",
        },
    )


def _megagiant_oil_gas_fields_source() -> ArcGISOpenDataSource:
    return ArcGISOpenDataSource(
        source_id="megagiant_oil_gas_fields_world",
        source_name="Megagiant Oil & Gas Fields of the World",
        layer_url="https://services7.arcgis.com/iEMmryaM5E3wkdnU/ArcGIS/rest/services/Megagiant_Oil_Gas_Fields_of_the_World/FeatureServer/0",
        sector="oil_and_gas",
        country="Global",
        external_id_fields=("FIELD_ID", "ObjectId"),
        company_fields=("FLD_NAME", "FIELD_ID"),
        country_fields=("COUNTRY",),
        commodity_fields=("FIELD_TYPE",),
        status_fields=("SIZE_CLASS",),
        region_builder=_megagiant_region,
        default_commodity="Oil & Gas",
        default_license_type="Oil & Gas Field",
        default_status="Field",
        record_origin="global_open_fallback",
        page_size=1000,
        sync_contacts=False,
        metadata={
            "kind": "global_open_fallback",
            "coverage": "world",
            "summary_note": (
                "Open global petroleum fallback for major oil and gas fields. "
                "Not an official licence or block registry."
            ),
            "note": "Coverage is biased toward very large fields and does not represent full terminal, lease, or permit coverage.",
        },
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
    _new_zealand_petroleum_source(),
    _british_columbia_mining_source(),
    _canada_northern_oil_rights_source(),
    _norway_production_licences_current_source(),
    _finland_active_mining_areas_source(),
    _queensland_mineral_tenement_source(),
    _usgs_mrds_global_source(),
    _megagiant_oil_gas_fields_source(),
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


# Countries frequently checked for ME / Europe / Asia visibility. These are included in
# `/api/open-data/coverage/world` even when the DB has zero rows so gaps stay explicit.
WORLD_COVERAGE_ATTENTION_COUNTRIES: tuple[str, ...] = (
    # Middle East & West Asia (non-African list)
    "Bahrain",
    "Iran",
    "Iraq",
    "Israel",
    "Jordan",
    "Kuwait",
    "Lebanon",
    "Oman",
    "Qatar",
    "Saudi Arabia",
    "Syria",
    "Turkey",
    "United Arab Emirates",
    "Yemen",
    # Europe (representative set; Norway/Finland appear via live sources)
    "Austria",
    "Belgium",
    "Czech Republic",
    "Denmark",
    "France",
    "Germany",
    "Greece",
    "Hungary",
    "Ireland",
    "Italy",
    "Netherlands",
    "Poland",
    "Portugal",
    "Romania",
    "Spain",
    "Sweden",
    "Switzerland",
    "United Kingdom",
    # Asia & Pacific (Australia appears via Queensland tenure; NZ already elsewhere)
    "Bangladesh",
    "China",
    "India",
    "Indonesia",
    "Japan",
    "Kazakhstan",
    "Malaysia",
    "Mongolia",
    "Nepal",
    "Pakistan",
    "Papua New Guinea",
    "Philippines",
    "South Korea",
    "Sri Lanka",
    "Thailand",
    "Turkmenistan",
    "Uzbekistan",
    "Vietnam",
)


AFRICAN_COUNTRY_NAMES: frozenset[str] = frozenset(name for _iso, name in AFRICAN_COUNTRIES)

_MIDDLE_EAST_AND_WEST_ASIA: frozenset[str] = frozenset(
    {
        "Bahrain",
        "Iran",
        "Iraq",
        "Israel",
        "Jordan",
        "Kuwait",
        "Lebanon",
        "Oman",
        "Qatar",
        "Saudi Arabia",
        "Syria",
        "Turkey",
        "United Arab Emirates",
        "Yemen",
    }
)

_EUROPE_NAMES: frozenset[str] = frozenset(
    {
        "Albania",
        "Andorra",
        "Austria",
        "Belarus",
        "Belgium",
        "Bosnia and Herzegovina",
        "Bulgaria",
        "Croatia",
        "Cyprus",
        "Czech Republic",
        "Denmark",
        "Estonia",
        "Finland",
        "France",
        "Germany",
        "Greece",
        "Hungary",
        "Iceland",
        "Ireland",
        "Italy",
        "Latvia",
        "Liechtenstein",
        "Lithuania",
        "Luxembourg",
        "Malta",
        "Moldova",
        "Monaco",
        "Montenegro",
        "Netherlands",
        "North Macedonia",
        "Norway",
        "Poland",
        "Portugal",
        "Romania",
        "Russia",
        "Russian Federation",
        "San Marino",
        "Serbia",
        "Slovakia",
        "Slovenia",
        "Spain",
        "Sweden",
        "Switzerland",
        "Ukraine",
        "United Kingdom",
        "Vatican City",
    }
)

_ASIA_PACIFIC_NAMES: frozenset[str] = frozenset(
    {
        "Afghanistan",
        "Armenia",
        "Azerbaijan",
        "Bangladesh",
        "Bhutan",
        "Brunei",
        "Cambodia",
        "China",
        "Georgia",
        "India",
        "Indonesia",
        "Japan",
        "Kazakhstan",
        "Kyrgyzstan",
        "Laos",
        "Malaysia",
        "Maldives",
        "Mongolia",
        "Myanmar",
        "Nepal",
        "North Korea",
        "Pakistan",
        "Philippines",
        "Singapore",
        "South Korea",
        "Sri Lanka",
        "Taiwan",
        "Tajikistan",
        "Thailand",
        "Timor-Leste",
        "Turkmenistan",
        "Uzbekistan",
        "Vietnam",
        "Australia",
        "Fiji",
        "New Zealand",
        "Papua New Guinea",
    }
)

_AMERICAS_NAMES: frozenset[str] = frozenset(
    {
        "Argentina",
        "Belize",
        "Bolivia",
        "Brazil",
        "Canada",
        "Chile",
        "Colombia",
        "Costa Rica",
        "Cuba",
        "Dominican Republic",
        "Ecuador",
        "El Salvador",
        "Guatemala",
        "Guyana",
        "Haiti",
        "Honduras",
        "Jamaica",
        "Mexico",
        "Nicaragua",
        "Panama",
        "Paraguay",
        "Peru",
        "Suriname",
        "Trinidad and Tobago",
        "United States",
        "Uruguay",
        "Venezuela",
    }
)


def infer_world_macro_region(country: str) -> str:
    """Coarse macro-region label for coverage dashboards (not a legal jurisdiction)."""
    label = (country or "").strip()
    if not label or label == "Global":
        return "other"
    if label in AFRICAN_COUNTRY_NAMES:
        return "africa"
    if label in _MIDDLE_EAST_AND_WEST_ASIA:
        return "middle_east"
    if label in _EUROPE_NAMES:
        return "europe"
    if label in _ASIA_PACIFIC_NAMES:
        return "asia_pacific"
    if label in _AMERICAS_NAMES:
        return "americas"
    return "other"


# Non-African coverage notes (token walls, portal-only cadastres, etc.).
WORLD_COVERAGE_OVERRIDES: dict[str, dict[str, dict[str, Any]]] = {
    "Philippines": {
        "mining": {
            "status": "official_api_restricted",
            "note": (
                "The Philippines MGB publishes a public geospatial portal, but the Approved Mining Tenement "
                "FeatureServer used by the map viewer currently requires an ArcGIS token for direct feature queries."
            ),
            "references": [
                {
                    "name": "MGB Philippines Geospatial (control map)",
                    "url": "https://controlmap.mgb.gov.ph/",
                    "access": "token_required",
                }
            ],
        }
    },
}


def _sector_coverage_overrides(country: str, sector: str) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    merged.update(WORLD_COVERAGE_OVERRIDES.get(country, {}).get(sector, {}))
    merged.update(AFRICA_COVERAGE_OVERRIDES.get(country, {}).get(sector, {}))
    return merged


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
    country = _resolve_country(source, attrs)
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
        "country": country,
        "region": region,
        "commodity": commodity,
        "license_type": license_type,
        "status": status,
        "lat": lat,
        "lng": lng,
        "date_issued": issued_at,
        "sector": source.sector,
        "record_origin": source.record_origin,
        "source_id": source.source_id,
        "source_name": source.source_name,
        "source_url": source.layer_url,
        "source_record_url": _resolve_source_record_url(source, attrs, external_ref),
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


def upsert_open_data_records(
    conn: Any,
    records: Iterable[dict[str, Any]],
    *,
    sync_contacts: bool = True,
) -> int:
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
            if sync_contacts:
                try:
                    sync_license_contacts_for_row(conn, record)
                except Exception as contact_exc:
                    print(f"[OpenData] Contact sync skipped for {record.get('id')}: {contact_exc}")
                try:
                    sync_license_relationships_for_row(conn, record)
                except Exception as rel_exc:
                    print(f"[OpenData] Relationship sync skipped for {record.get('id')}: {rel_exc}")
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
                written = upsert_open_data_records(conn, records, sync_contacts=source.sync_contacts)
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
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT source_name), NULL) AS source_names,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT source_id), NULL) AS source_ids
            FROM licenses
            WHERE record_origin = %s
            GROUP BY country, sector
            """,
            (record_origin,),
        )
        for country, sector, record_count, last_synced_at, source_names, source_ids in cur.fetchall():
            stats[(country, sector)] = {
                "record_count": int(record_count or 0),
                "last_synced_at": last_synced_at.isoformat() if last_synced_at else None,
                "source_names": list(source_names or []),
                "source_ids": list(source_ids or []),
            }
    return stats


def _query_source_stats(conn: Any) -> dict[str, dict[str, Any]]:
    stats: dict[str, dict[str, Any]] = {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                source_id,
                COUNT(*) AS record_count,
                MAX(last_synced_at) AS last_synced_at,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT country), NULL) AS countries_seen
            FROM licenses
            WHERE source_id IS NOT NULL
              AND source_id != ''
            GROUP BY source_id
            """
        )
        for source_id, record_count, last_synced_at, countries_seen in cur.fetchall():
            stats[source_id] = {
                "record_count": int(record_count or 0),
                "last_synced_at": last_synced_at.isoformat() if last_synced_at else None,
                "countries_seen": list(countries_seen or []),
            }
    return stats


@functools.lru_cache(maxsize=1)
def get_source_registry_index() -> dict[str, dict[str, Any]]:
    registry: dict[str, dict[str, Any]] = {}
    for source in OPEN_DATA_SOURCES:
        kind = _clean_text(source.metadata.get("kind")) or "official_arcgis_registry"
        if kind == "official_arcgis_registry":
            source_kind = "official_registry"
            source_access = _clean_text(source.metadata.get("source_access")) or "open_machine_readable"
            coverage_state = "official_syncable"
            provenance_note = _source_summary_note(source)
        else:
            source_kind = "global_open_fallback"
            source_access = _clean_text(source.metadata.get("source_access")) or "open_machine_readable"
            coverage_state = "global_fallback_only"
            provenance_note = _clean_text(source.metadata.get("summary_note")) or (
                "Open global dataset provides broad site visibility but is not an official licence registry."
            )

        registry[source.source_id] = {
            "source_kind": source_kind,
            "source_access": source_access,
            "coverage_state": coverage_state,
            "provenance_note": provenance_note,
            "coverage_scope": source.metadata.get("coverage") or "world",
            "jurisdiction_scope": source.metadata.get("jurisdiction_scope") or "country",
            "jurisdiction_label": source.metadata.get("jurisdiction_label"),
            "note": source.metadata.get("note"),
        }
    return registry


def describe_license_source_record(source_id: Optional[str], record_origin: Optional[str]) -> dict[str, Any]:
    registry = get_source_registry_index()
    if source_id and source_id in registry:
        return dict(registry[source_id])
    normalized_origin = (record_origin or "").strip().lower()
    if normalized_origin == "user_import_csv":
        return {
            "source_kind": "user_import_csv",
            "source_access": "user_import",
            "coverage_state": "user_import_csv",
            "provenance_note": "User-imported CSV fallback. Not an official live registry sync.",
            "coverage_scope": "ad_hoc",
            "jurisdiction_scope": "ad_hoc",
            "jurisdiction_label": None,
            "note": None,
        }
    if normalized_origin == "bundled_json":
        return {
            "source_kind": "bundled_json",
            "source_access": "bundled_snapshot",
            "coverage_state": "bundled_json",
            "provenance_note": "Bundled JSON snapshot fallback used when live sources are unavailable.",
            "coverage_scope": "snapshot",
            "jurisdiction_scope": "snapshot",
            "jurisdiction_label": None,
            "note": None,
        }
    return {
        "source_kind": "unknown",
        "source_access": "unknown",
        "coverage_state": "unknown",
        "provenance_note": None,
        "coverage_scope": "unknown",
        "jurisdiction_scope": "unknown",
        "jurisdiction_label": None,
        "note": None,
    }


def _build_syncable_source_coverage(
    predicate: Optional[Callable[[ArcGISOpenDataSource], bool]] = None,
) -> dict[tuple[str, str], dict[str, Any]]:
    coverage: dict[tuple[str, str], dict[str, Any]] = {}
    for source in OPEN_DATA_SOURCES:
        if source.record_origin != "open_data":
            continue
        if source.metadata.get("kind") != "official_arcgis_registry":
            continue
        if predicate and not predicate(source):
            continue
        if not source.country or source.country == "Global":
            continue
        key = (source.country, source.sector)
        entry = coverage.setdefault(
            key,
            {
                "status": "official_syncable",
                "note": _source_summary_note(source),
                "references": [],
                "source_ids": [],
            },
        )
        entry["source_ids"].append(source.source_id)
        entry["references"].append(
            {
                "name": source.source_name,
                "url": source.layer_url,
                "access": source.metadata.get("source_access") or "open_machine_readable",
            }
        )
    return coverage


def _build_syncable_africa_coverage() -> dict[tuple[str, str], dict[str, Any]]:
    return _build_syncable_source_coverage(
        lambda source: source.metadata.get("coverage") == "africa"
    )


def _build_world_source_catalog(conn: Any) -> list[dict[str, Any]]:
    registry = get_source_registry_index()
    stats = _query_source_stats(conn)
    catalog: list[dict[str, Any]] = []
    for source in OPEN_DATA_SOURCES:
        meta = registry.get(source.source_id, {})
        live = stats.get(source.source_id, {})
        catalog.append(
            {
                "source_id": source.source_id,
                "source_name": source.source_name,
                "sector": source.sector,
                "country": source.country,
                "source_url": source.layer_url,
                "source_kind": meta.get("source_kind"),
                "source_access": meta.get("source_access"),
                "coverage_state": meta.get("coverage_state"),
                "coverage_scope": meta.get("coverage_scope"),
                "jurisdiction_scope": meta.get("jurisdiction_scope"),
                "jurisdiction_label": meta.get("jurisdiction_label"),
                "provenance_note": meta.get("provenance_note"),
                "note": meta.get("note"),
                "record_count": live.get("record_count", 0),
                "last_synced_at": live.get("last_synced_at"),
                "countries_seen": live.get("countries_seen", []),
            }
        )
    return sorted(
        catalog,
        key=lambda item: (
            item.get("sector") or "",
            item.get("source_kind") or "",
            item.get("country") or "",
            item.get("source_name") or "",
        ),
    )


def get_world_coverage(conn: Any | None = None, region: Optional[str] = None) -> dict[str, Any]:
    own_connection = conn is None
    if conn is None:
        conn = _default_db_connection()

    try:
        official_stats = _query_record_origin_stats(conn, "open_data")
        global_fallback_stats = _query_record_origin_stats(conn, "global_open_fallback")
        user_import_stats = _query_record_origin_stats(conn, "user_import_csv")
        syncable = _build_syncable_source_coverage()
        countries_seen = {country for _, country in AFRICAN_COUNTRIES}
        countries_seen.update(WORLD_COVERAGE_ATTENTION_COUNTRIES)
        countries_seen.update(country for country, _sector in syncable.keys())
        countries_seen.update(country for country, _sector in official_stats.keys())
        countries_seen.update(country for country, _sector in global_fallback_stats.keys())
        countries_seen.update(country for country, _sector in user_import_stats.keys())

        countries: list[dict[str, Any]] = []
        summary: dict[str, dict[str, int]] = {
            "mining": {},
            "oil_and_gas": {},
        }

        for country in sorted(countries_seen):
            sector_coverage: dict[str, dict[str, Any]] = {}
            for sector in ("mining", "oil_and_gas"):
                base = {
                    "status": "unavailable",
                    "note": "No verified open official registry or global fallback is configured yet for this country and sector.",
                    "references": [],
                    "source_ids": [],
                    "record_count": 0,
                    "last_synced_at": None,
                    "fallback_record_count": 0,
                    "fallback_last_synced_at": None,
                    "fallback_sources": [],
                    "global_fallback_record_count": 0,
                    "global_fallback_last_synced_at": None,
                    "global_fallback_sources": [],
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

                override = _sector_coverage_overrides(country, sector)
                if override:
                    base.update(override)
                    base["references"] = list(override.get("references", base["references"]))
                    base["source_ids"] = list(override.get("source_ids", base["source_ids"]))

                official = official_stats.get((country, sector))
                if official:
                    base["record_count"] = official["record_count"]
                    base["last_synced_at"] = official["last_synced_at"]

                summary_bucket = summary[sector]

                global_fallback = global_fallback_stats.get((country, sector))
                if global_fallback:
                    base["global_fallback_record_count"] = global_fallback["record_count"]
                    base["global_fallback_last_synced_at"] = global_fallback["last_synced_at"]
                    base["global_fallback_sources"] = global_fallback["source_names"]
                    summary_bucket["countries_with_global_fallback"] = (
                        summary_bucket.get("countries_with_global_fallback", 0) + 1
                    )
                    if base["status"] == "unavailable":
                        base["status"] = "global_fallback_only"
                        base["note"] = (
                            "No verified open official registry is configured right now; "
                            "global fallback datasets provide site or field visibility here."
                        )

                imported = user_import_stats.get((country, sector))
                if imported:
                    base["fallback_record_count"] = imported["record_count"]
                    base["fallback_last_synced_at"] = imported["last_synced_at"]
                    base["fallback_sources"] = imported["source_names"]
                    summary_bucket["fallback_imported"] = summary_bucket.get("fallback_imported", 0) + 1

                summary_bucket[base["status"]] = summary_bucket.get(base["status"], 0) + 1
                sector_coverage[sector] = base

            countries.append(
                {
                    "country": country,
                    "macro_region": infer_world_macro_region(country),
                    "sectors": sector_coverage,
                }
            )

        all_countries = list(countries)

        regional_summary: dict[str, dict[str, dict[str, int]]] = {}
        for entry in all_countries:
            macro = entry.get("macro_region") or "other"
            bucket = regional_summary.setdefault(macro, {"mining": {}, "oil_and_gas": {}})
            for sector in ("mining", "oil_and_gas"):
                status = entry["sectors"][sector]["status"]
                sector_bucket = bucket[sector]
                sector_bucket[status] = sector_bucket.get(status, 0) + 1

        region_aliases = {
            "middle east": "middle_east",
            "middle_east": "middle_east",
            "me": "middle_east",
            "mena": "middle_east",
            "asia": "asia_pacific",
            "apac": "asia_pacific",
            "eu": "europe",
        }
        raw_region = (region or "").strip().lower().replace("-", "_")
        normalized_region = region_aliases.get(raw_region, raw_region)
        filtered_countries = all_countries
        if normalized_region and normalized_region != "all":
            filtered_countries = [
                item for item in all_countries if (item.get("macro_region") or "other") == normalized_region
            ]

        return {
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "summary": summary,
            "regional_summary": regional_summary,
            "region_filter": normalized_region or None,
            "countries": filtered_countries,
            "sources": _build_world_source_catalog(conn),
        }
    finally:
        if own_connection and conn is not None:
            conn.close()


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
