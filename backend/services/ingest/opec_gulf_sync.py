"""
OPEC & Persian Gulf Oil and Gas Data Ingest
============================================
Sources used:
  1. EIA Open Data API  -- live crude-oil production by OPEC country (no key required for
     the free v2 JSON endpoint; key required for the new v2 API but we gracefully
     degrade when not configured).
  2. Megagiant Oil & Gas ArcGIS layer -- already present in open_data_sync.py; this
     module adds MENA-filtered enrichment rows.
  3. Static reference seed -- the key Persian Gulf national oil companies and major
     fields that are not exposed by any open ArcGIS endpoint.  This is deliberately
     comprehensive so users immediately see major entities on the map.

Environment variables:
  EIA_API_KEY   -- optional; if set, the EIA v2 API is queried for live production
                   data which enriches the static rows with monthly production figures.
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# ── helpers ──────────────────────────────────────────────────────────────────

_EIA_HTTP_WARNED: set[str] = set()

# EIA international petroleum facets (align with petroleum_trade.fetch_eia_international).
_EIA_PRODUCTION_PRODUCT_ID = "5"   # Crude oil including lease condensate
_EIA_PRODUCTION_ACTIVITY_ID = "1"  # Production
_EIA_PRODUCTION_UNIT = "TBPD"


def _redact_api_key(url: str) -> str:
    key = (os.getenv("EIA_API_KEY") or "").strip()
    if key and key in url:
        url = url.replace(key, "***")
    return re.sub(r"([?&]api_key=)[^&]+", r"\1***", url)


def _get(url: str, timeout: int = 15, *, context: str = "request") -> Optional[dict]:
    """Simple HTTP GET → parsed JSON.  Returns None on any failure."""
    safe_url = _redact_api_key(url)
    try:
        req = Request(url, headers={"User-Agent": "mining-map-opec-sync/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as exc:
        if exc.code == 400 and "eia_400" not in _EIA_HTTP_WARNED:
            _EIA_HTTP_WARNED.add("eia_400")
            print(
                "[OPEC] EIA API returned HTTP 400 for production query "
                "(invalid facets or parameters); skipping live enrichment."
            )
        elif exc.code not in (400,) and context not in _EIA_HTTP_WARNED:
            _EIA_HTTP_WARNED.add(context)
            print(f"[OPEC] HTTP {exc.code} for {safe_url}: {exc.reason}")
        return None
    except (URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        if context not in _EIA_HTTP_WARNED:
            _EIA_HTTP_WARNED.add(context)
            print(f"[OPEC] HTTP error for {safe_url}: {exc}")
        return None
    except Exception as exc:
        if context not in _EIA_HTTP_WARNED:
            _EIA_HTTP_WARNED.add(context)
            print(f"[OPEC] HTTP error for {safe_url}: {exc}")
        return None


# ── EIA production data ───────────────────────────────────────────────────────

EIA_API_KEY = os.getenv("EIA_API_KEY", "")

# EIA series IDs for monthly crude-oil production (kb/d) per OPEC member
# Source: EIA API v2 international petroleum
_EIA_OPEC_COUNTRY_CODES = {
    "Saudi Arabia": "SAU",
    "Iraq": "IRQ",
    "Iran": "IRN",
    "Kuwait": "KWT",
    "United Arab Emirates": "ARE",
    "Qatar": "QAT",
    "Libya": "LBY",
    "Algeria": "DZA",
    "Nigeria": "NGA",
    "Gabon": "GAB",
    "Congo": "COG",
    "Equatorial Guinea": "GNQ",
    "Venezuela": "VEN",
    "Ecuador": "ECU",
}


def _eia_production_url(country_iso3: str, *, api_key: str = EIA_API_KEY) -> str:
    """Build EIA v2 international production query (monthly kb/d)."""
    params = {
        "api_key": api_key,
        "frequency": "monthly",
        "data[0]": "value",
        "facets[countryRegionId][]": country_iso3,
        "facets[productId][]": _EIA_PRODUCTION_PRODUCT_ID,
        "facets[activityId][]": _EIA_PRODUCTION_ACTIVITY_ID,
        "facets[unit][]": _EIA_PRODUCTION_UNIT,
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "length": "1",
        "offset": "0",
    }
    return f"https://api.eia.gov/v2/international/data/?{urlencode(params)}"


def fetch_eia_production(country_iso3: str) -> Optional[float]:
    """
    Fetch the latest monthly crude-oil production (thousand barrels/day)
    from the EIA v2 API for a given ISO-3 country code.
    Returns None if EIA_API_KEY is not set or the request fails.
    """
    if not EIA_API_KEY:
        return None
    url = _eia_production_url(country_iso3)
    data = _get(url, context=f"eia_prod:{country_iso3}")
    if not data:
        return None
    try:
        rows = data["response"]["data"]
        if rows:
            return float(rows[0]["value"])
    except (KeyError, IndexError, TypeError, ValueError):
        pass
    return None


def fetch_eia_opec_production() -> dict[str, float]:
    """Returns {country_name: production_kbd} for OPEC members where EIA data is available."""
    result: dict[str, float] = {}
    if not EIA_API_KEY:
        print("[OPEC] EIA_API_KEY not set — skipping live production enrichment")
        return result
    for country, iso3 in _EIA_OPEC_COUNTRY_CODES.items():
        val = fetch_eia_production(iso3)
        if val is not None:
            result[country] = val
        time.sleep(0.15)   # be polite to EIA
    return result


# ── Static Persian-Gulf / OPEC reference data ────────────────────────────────

@dataclass
class GulfOilEntity:
    company: str
    country: str
    region: str
    lat: float
    lng: float
    commodity: str
    license_type: str
    status: str
    source_url: Optional[str] = None
    production_kbd: Optional[float] = None     # filled in by EIA enrichment
    notes: str = ""
    entity_subtype: str = "oil_field"


def _resolve_entity_subtype(entity: GulfOilEntity) -> str:
    """Map license_type text to stable entity_subtype for map icons and filters."""
    if entity.entity_subtype != "oil_field":
        return entity.entity_subtype
    lt = entity.license_type.lower()
    if "refinery" in lt or "refining" in lt:
        return "refinery"
    if "export terminal" in lt or lt.endswith("terminal"):
        return "export_terminal"
    if "gas processing" in lt or "lng" in lt:
        return "gas_processing"
    if entity.commodity.lower().startswith(("steel", "gold", "aluminium", "aluminum", "phosphate")):
        return "mining"
    return entity.entity_subtype


def _sector_for_entity(entity: GulfOilEntity) -> str:
    """Oil & Gas map view filters on sector — mining industrial rows belong in mining."""
    if _resolve_entity_subtype(entity) == "mining":
        return "mining"
    return "oil_and_gas"


# Key Persian-Gulf / OPEC entities — national oil companies + major fields
# Coordinates are field/HQ centroids from public domain sources.
GULF_OIL_ENTITIES: list[GulfOilEntity] = [
    # ── Saudi Arabia ──────────────────────────────────────────────────────────
    GulfOilEntity("Saudi Aramco", "Saudi Arabia", "Dhahran, Eastern Province",
                  26.319, 50.110, "Crude Oil", "National Oil Company", "Active",
                  "https://www.aramco.com/", notes="World's largest oil producer by output."),
    GulfOilEntity("Ghawar Oil Field", "Saudi Arabia", "Al-Ahsa, Eastern Province",
                  25.120, 49.850, "Crude Oil", "Supergiant Oil Field", "Producing",
                  notes="Largest conventional oil field in the world (~3.8 Mb/d)."),
    GulfOilEntity("Safaniya Oil Field", "Saudi Arabia", "Arabian Gulf, Offshore",
                  27.980, 48.760, "Crude Oil", "Offshore Supergiant Field", "Producing",
                  notes="World's largest offshore oil field."),
    GulfOilEntity("Khurais Oil Field", "Saudi Arabia", "Riyadh Region",
                  24.920, 48.120, "Crude Oil", "Giant Oil Field", "Producing"),
    GulfOilEntity("Abqaiq Processing Facility", "Saudi Arabia", "Eastern Province",
                  25.925, 49.686, "Crude Oil", "Central Processing Facility", "Active",
                  notes="World's largest crude oil stabilisation facility."),
    GulfOilEntity("Ras Tanura Terminal", "Saudi Arabia", "Eastern Province",
                  26.637, 50.155, "Crude Oil", "Export Terminal", "Active",
                  notes="Largest oil export terminal in the world."),
    GulfOilEntity("Shaybah Oil Field", "Saudi Arabia", "Rub al Khali",
                  22.500, 53.900, "Crude Oil", "Giant Oil Field", "Producing"),

    # ── United Arab Emirates ──────────────────────────────────────────────────
    GulfOilEntity("ADNOC (Abu Dhabi National Oil Company)", "United Arab Emirates", "Abu Dhabi",
                  24.450, 54.377, "Crude Oil & Gas", "National Oil Company", "Active",
                  "https://www.adnoc.ae/"),
    GulfOilEntity("Zakum Oil Field", "United Arab Emirates", "Abu Dhabi Offshore",
                  24.850, 53.380, "Crude Oil", "Supergiant Offshore Field", "Producing",
                  notes="Third-largest oil field in the Middle East (~1 Mb/d)."),
    GulfOilEntity("ADNOC Refining (Ruwais)", "United Arab Emirates", "Al Dhafra, Abu Dhabi",
                  24.112, 52.728, "Refined Products", "Refinery Complex", "Active",
                  notes="One of the world's largest refinery complexes (~922 kb/d).",
                  entity_subtype="refinery"),
    GulfOilEntity("ENOC Jebel Ali Refinery", "United Arab Emirates", "Jebel Ali, Dubai",
                  25.010, 55.060, "Refined Products", "Refinery", "Active",
                  notes="Dubai's primary refining complex on the Arabian Gulf coast.",
                  entity_subtype="refinery"),
    GulfOilEntity("Fujairah Oil Industry Zone (FOIZ)", "United Arab Emirates", "Fujairah",
                  25.116, 56.356, "Refined Products", "Refinery Complex", "Active",
                  notes="Strategic bunkering and refining hub at the Gulf of Oman.",
                  entity_subtype="refinery"),
    GulfOilEntity("Murban Oil Field", "United Arab Emirates", "Abu Dhabi Onshore",
                  23.800, 53.750, "Crude Oil", "Giant Oil Field", "Producing"),
    GulfOilEntity("ADNOC Gas Processing (Habshan)", "United Arab Emirates", "Al Dhafra",
                  23.832, 53.535, "Natural Gas", "Gas Processing Plant", "Active"),

    # ── Kuwait ────────────────────────────────────────────────────────────────
    GulfOilEntity("Kuwait Petroleum Corporation (KPC)", "Kuwait", "Kuwait City",
                  29.369, 47.978, "Crude Oil", "National Oil Company", "Active",
                  "https://www.kpc.com.kw/"),
    GulfOilEntity("Kuwait Oil Company (KOC)", "Kuwait", "Ahmadi Governorate",
                  29.076, 48.083, "Crude Oil", "Operating Company", "Active"),
    GulfOilEntity("Greater Burgan Oil Field", "Kuwait", "Ahmadi",
                  28.950, 48.020, "Crude Oil", "Supergiant Oil Field", "Producing",
                  notes="Second-largest oil field in the world."),
    GulfOilEntity("Minagish Oil Field", "Kuwait", "Al Jahra",
                  29.150, 47.500, "Crude Oil", "Giant Oil Field", "Producing"),
    GulfOilEntity("Mina Al-Ahmadi Refinery", "Kuwait", "Ahmadi",
                  29.076, 48.135, "Refined Products", "Refinery", "Active",
                  notes="Largest refinery in Kuwait.",
                  entity_subtype="refinery"),

    # ── Qatar ─────────────────────────────────────────────────────────────────
    GulfOilEntity("QatarEnergy (formerly Qatar Petroleum)", "Qatar", "Doha",
                  25.286, 51.531, "LNG & Crude Oil", "National Oil Company", "Active",
                  "https://www.qatarenergy.qa/"),
    GulfOilEntity("North Dome / South Pars Gas Field", "Qatar", "Offshore — Persian Gulf",
                  26.800, 52.800, "Natural Gas / LNG", "Supergiant Gas Field", "Producing",
                  notes="World's largest natural gas field, shared with Iran."),
    GulfOilEntity("Ras Laffan Industrial City", "Qatar", "Al Khor",
                  25.911, 51.556, "LNG / Petrochemicals", "Export Hub / Industrial City", "Active",
                  notes="World's leading LNG export hub."),
    GulfOilEntity("Al-Shaheen Oil Field", "Qatar", "Offshore Block 5",
                  26.100, 51.900, "Crude Oil", "Offshore Oil Field", "Producing"),

    # ── Iran ──────────────────────────────────────────────────────────────────
    GulfOilEntity("National Iranian Oil Company (NIOC)", "Iran", "Tehran",
                  35.693, 51.420, "Crude Oil", "National Oil Company", "Active",
                  notes="OFAC-sanctioned entity — requires compliance check."),
    GulfOilEntity("South Pars Gas Field (Iran side)", "Iran", "Bushehr Province",
                  27.100, 52.500, "Natural Gas", "Supergiant Gas Field", "Producing",
                  notes="Iranian side of the North Dome / South Pars mega-field."),
    GulfOilEntity("Ahvaz Oil Field", "Iran", "Khuzestan Province",
                  31.320, 48.680, "Crude Oil", "Supergiant Oil Field", "Producing",
                  notes="Largest oil field in Iran."),
    GulfOilEntity("Gachsaran Oil Field", "Iran", "Kohgiluyeh Province",
                  30.355, 50.797, "Crude Oil", "Giant Oil Field", "Producing"),
    GulfOilEntity("Kharg Island Export Terminal", "Iran", "Persian Gulf",
                  29.254, 50.315, "Crude Oil", "Export Terminal", "Active",
                  notes="Handles ~90% of Iranian crude oil exports."),
    GulfOilEntity("Pars Oil and Gas Company", "Iran", "Bushehr",
                  28.920, 50.820, "Natural Gas", "National Operating Company", "Active"),

    # ── Iraq ──────────────────────────────────────────────────────────────────
    GulfOilEntity("Iraq National Oil Company (INOC)", "Iraq", "Baghdad",
                  33.341, 44.361, "Crude Oil", "National Oil Company", "Active",
                  "https://www.inoc.com.iq/"),
    GulfOilEntity("Rumaila Oil Field", "Iraq", "Basra Governorate",
                  30.250, 47.440, "Crude Oil", "Supergiant Oil Field", "Producing",
                  notes="One of the world's largest oil fields (~1.4 Mb/d); operated by BP/PetroChina JV."),
    GulfOilEntity("West Qurna Oil Field", "Iraq", "Basra Governorate",
                  30.503, 47.607, "Crude Oil", "Supergiant Oil Field", "Producing",
                  notes="Split into West Qurna-1 (ExxonMobil/PetroChina) & WQ-2 (Lukoil)."),
    GulfOilEntity("Kirkuk Oil Field", "Iraq", "Kirkuk Governorate",
                  35.482, 44.390, "Crude Oil", "Supergiant Oil Field", "Producing"),
    GulfOilEntity("Halfaya Oil Field", "Iraq", "Missan Governorate",
                  31.700, 47.550, "Crude Oil", "Giant Oil Field", "Producing",
                  notes="Operated by CNPCi / Petronas / TotalEnergies."),
    GulfOilEntity("Basra Oil Terminal (Al Basra & Khor Al Amaya)", "Iraq", "Basra, Offshore",
                  29.680, 48.800, "Crude Oil", "Export Terminal", "Active",
                  notes="Iraq's main offshore export terminals (~3 Mb/d capacity)."),
    GulfOilEntity("Majnoon Oil Field", "Iraq", "Basra",
                  31.550, 47.750, "Crude Oil", "Giant Oil Field", "Producing"),

    # ── Oman ──────────────────────────────────────────────────────────────────
    GulfOilEntity("Petroleum Development Oman (PDO)", "Oman", "Muscat",
                  23.614, 58.593, "Crude Oil & Gas", "Operating Company (Shell/TotalEnergies JV)", "Active",
                  "https://www.pdo.co.om/"),
    GulfOilEntity("Yibal Oil Field", "Oman", "North Oman",
                  22.200, 56.900, "Crude Oil", "Giant Oil Field", "Producing",
                  notes="Oman's oldest and historically largest oil field."),
    GulfOilEntity("Oman LNG — Qalhat", "Oman", "Sur, Al Sharqiyah",
                  22.556, 59.508, "LNG", "LNG Export Terminal", "Active"),
    GulfOilEntity("BP Khazzan Gas Field", "Oman", "Central Oman",
                  23.100, 57.200, "Natural Gas / Tight Gas", "Tight Gas Field", "Producing",
                  notes="Deep tight-gas development by BP; critical for Oman domestic supply."),

    # ── Bahrain ───────────────────────────────────────────────────────────────
    GulfOilEntity("Bapco Energies (Bahrain Petroleum)", "Bahrain", "Awali",
                  26.069, 50.559, "Crude Oil & Refined Products", "National Oil Company", "Active",
                  "https://www.bapco.net/"),
    GulfOilEntity("Awali Oil Field", "Bahrain", "Central Governorate",
                  26.069, 50.559, "Crude Oil", "Oil Field (Oldest in the Gulf)", "Producing",
                  notes="First commercial oil discovery in the Persian Gulf (1932)."),
    GulfOilEntity("Khaleej Al Bahrain Basin (Offshore)", "Bahrain", "Offshore",
                  25.700, 50.400, "Crude Oil & Natural Gas", "Offshore Discovery", "Development",
                  notes="Major 2018 discovery — potentially largest oil/gas find in Bahrain's history."),

    # ── Libya (OPEC) ─────────────────────────────────────────────────────────
    GulfOilEntity("National Oil Corporation (NOC Libya)", "Libya", "Tripoli",
                  32.898, 13.180, "Crude Oil", "National Oil Company", "Active",
                  "http://www.noclibya.com.ly/"),
    GulfOilEntity("Waha Oil Fields Complex", "Libya", "Sirte Basin",
                  29.100, 21.500, "Crude Oil", "Giant Oil Field Cluster", "Intermittent",
                  notes="Operated by Waha Oil Company (TotalEnergies / ConocoPhillips involvement)."),
    GulfOilEntity("Es Sider Export Terminal", "Libya", "Ras Lanuf",
                  30.510, 18.570, "Crude Oil", "Export Terminal", "Intermittent",
                  notes="Libya's largest oil export terminal."),

    # ── Algeria (OPEC) ────────────────────────────────────────────────────────
    GulfOilEntity("Sonatrach", "Algeria", "Algiers",
                  36.752, 3.042, "Crude Oil & Natural Gas", "National Oil Company", "Active",
                  "https://www.sonatrach.com/"),
    GulfOilEntity("Hassi Messaoud Oil Field", "Algeria", "Ouargla Province",
                  31.673, 6.074, "Crude Oil", "Giant Oil Field", "Producing",
                  notes="Algeria's most important oil field."),
    GulfOilEntity("Hassi R'Mel Gas Field", "Algeria", "Laghouat Province",
                  32.941, 3.088, "Natural Gas", "Giant Gas Field", "Producing",
                  notes="Largest gas field in Algeria and one of the largest in the world."),

    # ── Nigeria (OPEC) ────────────────────────────────────────────────────────
    GulfOilEntity("Nigerian National Petroleum Corporation (NNPC)", "Nigeria", "Abuja",
                  9.057, 7.491, "Crude Oil", "National Oil Company", "Active",
                  "https://www.nnpcgroup.com/"),
    GulfOilEntity("Niger Delta Oil Fields", "Nigeria", "Niger Delta",
                  5.500, 6.000, "Crude Oil", "Oil Field Region", "Producing",
                  notes="Majority of Nigerian crude oil production; multiple JVs with Shell, Chevron, TotalEnergies."),
    GulfOilEntity("Bonga Deep-Water Field", "Nigeria", "Offshore Nigeria",
                  3.650, 5.070, "Crude Oil", "Deepwater Oil Field", "Producing",
                  notes="Operated by Shell. Nigeria's first deepwater development."),

    # ── Venezuela (OPEC) ─────────────────────────────────────────────────────
    GulfOilEntity("PDVSA (Petróleos de Venezuela)", "Venezuela", "Caracas",
                  10.488, -66.879, "Heavy Crude Oil", "National Oil Company", "Restricted",
                  notes="Under US/EU sanctions. Orinoco Belt is world's largest proven oil reserves."),
    GulfOilEntity("Orinoco Heavy Oil Belt", "Venezuela", "Orinoco Basin",
                  8.200, -63.500, "Extra Heavy Crude Oil", "Supergiant Oil Belt", "Producing",
                  notes="Largest proven oil reserve in the world (~300 Gb)."),
]


# ── DB seeding ───────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def seed_gulf_oil_entities(conn: Any, production_data: Optional[dict[str, float]] = None) -> int:
    """
    Upsert Persian-Gulf / OPEC reference entities into the licenses table.
    Returns the count of rows written.
    """
    written = 0
    production_data = production_data or {}

    with conn.cursor() as cur:
        for entity in GULF_OIL_ENTITIES:
            external_id = f"opec_gulf_{entity.company.lower().replace(' ', '_')[:60]}"
            production_kbd = production_data.get(entity.country, entity.production_kbd)
            commodity = entity.commodity
            if production_kbd:
                commodity = f"{entity.commodity} ({production_kbd:,.0f} kb/d)"

            sector = _sector_for_entity(entity)
            try:
                cur.execute(
                    """
                    INSERT INTO licenses (
                        id, company, country, region, lat, lng,
                        commodity, license_type, status,
                        sector, record_origin, source_kind, source_id, source_name,
                        external_id, source_record_url,
                        last_synced_at, entity_kind, entity_subtype,
                        confidence_score, confidence_note
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s, %s, %s,
                        %s, %s,
                        NOW(), %s, %s,
                        %s, %s
                    )
                    ON CONFLICT (external_id) DO UPDATE SET
                        company          = EXCLUDED.company,
                        country          = EXCLUDED.country,
                        region           = EXCLUDED.region,
                        lat              = EXCLUDED.lat,
                        lng              = EXCLUDED.lng,
                        commodity        = EXCLUDED.commodity,
                        license_type     = EXCLUDED.license_type,
                        status           = EXCLUDED.status,
                        sector           = EXCLUDED.sector,
                        record_origin    = EXCLUDED.record_origin,
                        source_kind      = EXCLUDED.source_kind,
                        source_id        = EXCLUDED.source_id,
                        source_name      = EXCLUDED.source_name,
                        last_synced_at   = NOW(),
                        entity_subtype   = EXCLUDED.entity_subtype,
                        confidence_score = EXCLUDED.confidence_score,
                        confidence_note  = EXCLUDED.confidence_note
                    """,
                    (
                        str(uuid.uuid4()),
                        entity.company, entity.country, entity.region,
                        entity.lat, entity.lng,
                        commodity, entity.license_type, entity.status,
                        sector, "global_open_fallback", "global_open_fallback",
                        "opec_gulf_reference",
                        "OPEC / Persian Gulf Reference Data",
                        external_id, entity.source_url,
                        "license", _resolve_entity_subtype(entity),
                        0.72,
                        "Curated OPEC/Persian Gulf reference row; verify against official registry before execution.",
                    ),
                )
                written += 1
            except Exception as exc:
                print(f"[OPEC] Failed to upsert {entity.company}: {exc}")
                conn.rollback()
                continue

        # Legacy rows: mining industrial companies were once seeded with oil_and_gas sector.
        cur.execute(
            """
            UPDATE licenses
            SET sector = 'mining'
            WHERE external_id LIKE 'opec_gulf_%%'
              AND entity_subtype = 'mining'
              AND LOWER(TRIM(COALESCE(sector, ''))) = 'oil_and_gas'
            """,
            (),
        )
        removed_external_ids = (
            "opec_gulf_ma'aden_mining_company",
            "opec_gulf_emirates_steel_/_emirates_global_aluminium",
        )
        cur.execute(
            """
            DELETE FROM licenses
            WHERE external_id = ANY(%s)
            """,
            (list(removed_external_ids),),
        )

    conn.commit()
    return written


def sync_opec_gulf_data(conn: Any) -> dict[str, Any]:
    """
    Main entry point called from main.py _bootstrap_open_data.
    1. Fetches live EIA production data (if EIA_API_KEY set).
    2. Upserts all GULF_OIL_ENTITIES into the licenses table.
    Returns a summary dict.
    """
    print("[OPEC] Starting OPEC / Persian Gulf data sync...")
    t0 = time.time()

    production_data = fetch_eia_opec_production()
    if production_data:
        print(f"[OPEC] EIA live production data retrieved for {len(production_data)} countries.")
    else:
        print("[OPEC] No EIA production data — using static reference only.")

    written = seed_gulf_oil_entities(conn, production_data)
    elapsed = time.time() - t0

    print(f"[OPEC] Sync complete. {written} entities upserted in {elapsed:.1f}s.")
    return {
        "entities_written": written,
        "eia_countries_enriched": len(production_data),
        "elapsed_s": round(elapsed, 2),
    }
