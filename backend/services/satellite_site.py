"""Site-level satellite context for dossier (links + ESG — no mock imagery ingest)."""

from __future__ import annotations

from typing import Any, Optional


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def build_satellite_site_payload(
    *,
    entity_id: str,
    company: str,
    country: str,
    lat: Optional[float],
    lng: Optional[float],
    esg_zone: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    limitations = [
        "Visual screening only — not a substitute for on-site survey or licensed imagery analysis.",
        "Tiles are Esri World Imagery / OpenTopoMap; resolution varies by region.",
    ]
    links: list[dict[str, str]] = []

    if lat is not None and lng is not None:
        lat_f = float(lat)
        lng_f = float(lng)
        links = [
            {
                "label": "Google Maps (satellite)",
                "url": f"https://www.google.com/maps/@{lat_f},{lng_f},17z/data=!3m1!1e3",
            },
            {
                "label": "Sentinel Hub Browser",
                "url": (
                    "https://browser.dataspace.copernicus.eu/?zoom=14"
                    f"&lat={lat_f}&lng={lng_f}&themeId=DEFAULT-TERRAIN"
                ),
            },
            {
                "label": "OpenStreetMap",
                "url": f"https://www.openstreetmap.org/#map=16/{lat_f}/{lng_f}",
            },
        ]
    else:
        limitations.append("License has no coordinates — geocode or edit lat/lng to enable site view.")

    return {
        "entity_id": entity_id,
        "company": company,
        "country": country,
        "lat": lat,
        "lng": lng,
        "has_coordinates": lat is not None and lng is not None,
        "esg_intersection": esg_zone,
        "links": links,
        "limitations": limitations,
        "tile_attribution": "Esri World Imagery · OpenTopoMap",
    }
