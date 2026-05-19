"""Human-readable routing engine labels and per-leg limitations for the API/UI."""

from __future__ import annotations

from typing import Any

ROUTING_ENGINE_BY_SOURCE: dict[str, str] = {
    "osrm": "Real road (OSRM)",
    "searoute": "Marine network (searoute)",
    "corridor_fallback": "Offshore corridor (approximate)",
    "corridor_segment": "Offshore corridor segment",
    "great_circle": "Flight path (great-circle, not airways)",
    "air_great_circle_trunk": "Flight path (great-circle, not airways)",
    "rail_osm": "Rail corridor (OpenStreetMap)",
    "rail_osrm": "Rail access via roads (OSRM)",
    "rail_approximation_road": "Rail via roads (approximate)",
    "rail_hub": "Rail hub connector (approximate)",
    "rail_short_haul": "Rail short segment (approximate)",
    "rail_rejected": "Rail unavailable",
    "straight_line": "Straight line (approximate)",
    "straight_line_fallback": "Straight-line fallback",
    "offshore_connector": "Offshore connector",
}


def routing_engine_label(geometry_source: str, method: str = "") -> str:
    source = (geometry_source or "").strip().lower()
    if source in ROUTING_ENGINE_BY_SOURCE:
        return ROUTING_ENGINE_BY_SOURCE[source]
    method_key = (method or "").strip().lower()
    if method_key == "sea":
        return "Marine route (unknown source)"
    if method_key == "rail":
        return "Rail route (unknown source)"
    if method_key == "air":
        return "Flight path (unknown source)"
    return "Road route (unknown source)"


def leg_limitations(
    *,
    method: str,
    geometry_source: str,
    notes: list[str] | None = None,
) -> list[str]:
    """Short, UI-safe limitation lines for a single leg."""
    source = (geometry_source or "").strip().lower()
    method_key = (method or "").strip().lower()
    out: list[str] = []

    if source == "straight_line_fallback":
        out.append("Road network unavailable; straight-line fallback used.")
    elif source == "osrm":
        out.append("Driving network only — not a contracted lane or permit path.")
    elif source == "searoute":
        out.append("Marine network excludes port berthing, canal bookings, and weather routing.")
    elif source in {"corridor_fallback", "corridor_segment"}:
        out.append("Static offshore waypoints — not a live sailing chart or ETAs.")
    elif source == "rail_osm":
        out.append("OSM railway geometry — gauge, electrification, and slot availability not verified.")
    elif source in {"rail_approximation_road", "rail_osrm", "rail_hub", "rail_short_haul"}:
        out.append("No OSM rail corridor found; land movement approximated with driving roads.")
    elif source in {"air_great_circle_trunk", "great_circle"} and method_key == "air":
        out.append("Great-circle trunk only — not published airways, slots, or fuel stops.")
    elif source == "rail_rejected":
        out.append("Rail corridor rejected; road geometry substituted.")

    for note in notes or []:
        text = str(note).strip()
        if not text:
            continue
        lowered = text.lower()
        if "offshore anchor" in lowered and "offshore anchor" not in " ".join(out).lower():
            out.append("Sea endpoints snapped to offshore anchors (ports are on land).")
        elif "rail_approximation" in lowered or "no osm rail" in lowered:
            if not any("no osm rail" in item.lower() for item in out):
                out.append("Hub-to-hub rail used road approximation where OSM had no track geometry.")
        elif "gibraltar guard" in lowered:
            out.append("Gibraltar guard waypoints applied to avoid land clipping.")
        elif "deadline" in lowered and not any("deadline" in item.lower() for item in out):
            out.append("External router skipped due to route-plan time budget.")

    return out[:6]


def enrich_leg_payload(leg: dict[str, Any]) -> dict[str, Any]:
    """Attach routing_engine and limitations[] when missing from a leg dict."""
    source = str(leg.get("geometry_source") or "")
    method = str(leg.get("method") or "")
    notes = leg.get("notes") if isinstance(leg.get("notes"), list) else []
    enriched = dict(leg)
    enriched.setdefault("routing_engine", routing_engine_label(source, method))
    enriched.setdefault("limitations", leg_limitations(method=method, geometry_source=source, notes=notes))
    return enriched
