"""Normalize AISStream payloads into rich vessel records for API responses."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional


NAVIGATIONAL_STATUS_LABELS: dict[int, str] = {
    0: "Under way using engine",
    1: "At anchor",
    2: "Not under command",
    3: "Restricted manoeuvrability",
    4: "Constrained by draught",
    5: "Moored",
    6: "Aground",
    7: "Engaged in fishing",
    8: "Under way sailing",
    9: "Reserved HSC",
    10: "Reserved WIG",
    11: "Power-driven towing astern",
    12: "Power-driven pushing ahead or towing alongside",
    13: "Reserved",
    14: "AIS-SART",
    15: "Undefined",
}


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return " ".join(value.split()).strip()
    return str(value).strip()


def _pascal_to_snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def navigational_status_label(code: Any) -> Optional[str]:
    try:
        key = int(code)
    except (TypeError, ValueError):
        return None
    return NAVIGATIONAL_STATUS_LABELS.get(key)


def extract_dimensions(body: dict[str, Any]) -> Optional[dict[str, Any]]:
    dimension = body.get("Dimension")
    if not isinstance(dimension, dict):
        return None
    try:
        a = int(dimension.get("A", 0) or 0)
        b = int(dimension.get("B", 0) or 0)
        c = int(dimension.get("C", 0) or 0)
        d = int(dimension.get("D", 0) or 0)
    except (TypeError, ValueError):
        return None
    return {
        "to_bow": a,
        "to_stern": b,
        "to_port": c,
        "to_starboard": d,
        "length_m": a + b,
        "width_m": c + d,
        "raw": dimension,
    }


def extract_eta(body: dict[str, Any]) -> Optional[dict[str, Any]]:
    eta = body.get("Eta")
    if not isinstance(eta, dict):
        return None
    return {
        "month": eta.get("Month"),
        "day": eta.get("Day"),
        "hour": eta.get("Hour"),
        "minute": eta.get("Minute"),
        "raw": eta,
    }


def _coerce_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_bool(value: Any) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes"}:
            return True
        if lowered in {"false", "0", "no"}:
            return False
    return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_vessel_accumulator(mmsi: str) -> dict[str, Any]:
    return {
        "mmsi": mmsi,
        "ais_messages": {},
        "ais_metadata": {},
        "message_types_seen": [],
        "last_message_type": None,
        "last_message_at": None,
    }


def merge_ais_stream_message(accumulator: dict[str, Any], raw_message: dict[str, Any]) -> None:
    """Merge one AISStream envelope into a per-MMSI accumulator."""
    message_type = _clean_text(raw_message.get("MessageType"))
    metadata = raw_message.get("MetaData") or raw_message.get("Metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}

    body_holder = raw_message.get("Message") or {}
    body: dict[str, Any] = {}
    if isinstance(body_holder, dict):
        body = body_holder.get(message_type) or {}
        if not body and body_holder:
            first = next(iter(body_holder.values()), {})
            body = first if isinstance(first, dict) else {}

    if not isinstance(body, dict):
        body = {}

    observed_at = _clean_text(metadata.get("time_utc")) or _now_iso()
    if message_type:
        accumulator["ais_messages"][message_type] = {
            "body": body,
            "metadata": metadata,
            "received_at": observed_at,
        }
        if message_type not in accumulator["message_types_seen"]:
            accumulator["message_types_seen"].append(message_type)
        accumulator["last_message_type"] = message_type
        accumulator["last_message_at"] = observed_at

    if metadata:
        accumulator["ais_metadata"].update(metadata)

    mmsi = _clean_text(
        metadata.get("MMSI")
        or body.get("UserID")
        or body.get("MMSI")
        or accumulator.get("mmsi")
    )
    if mmsi:
        accumulator["mmsi"] = str(mmsi)

    ship_name = _clean_text(metadata.get("ShipName") or body.get("Name"))
    if ship_name:
        accumulator["vessel_name"] = ship_name

    lat = metadata.get("latitude", metadata.get("Latitude", body.get("Latitude")))
    lng = metadata.get("longitude", metadata.get("Longitude", body.get("Longitude")))
    lat_f = _coerce_float(lat)
    lng_f = _coerce_float(lng)
    if lat_f is not None:
        accumulator["lat"] = lat_f
    if lng_f is not None:
        accumulator["lng"] = lng_f

    if observed_at:
        accumulator["observed_at"] = observed_at

    sog = body.get("Sog")
    if sog is not None:
        accumulator["speed_knots"] = _coerce_float(sog)

    cog = body.get("Cog")
    if cog is not None:
        accumulator["course_over_ground"] = _coerce_float(cog)

    heading = body.get("TrueHeading")
    if heading is not None:
        accumulator["true_heading"] = _coerce_int(heading)

    call_sign = _clean_text(body.get("CallSign"))
    if call_sign:
        accumulator["call_sign"] = call_sign

    imo = body.get("ImoNumber") or body.get("IMO") or body.get("Imo")
    imo_text = _clean_text(imo)
    if imo_text:
        accumulator["imo"] = imo_text

    destination = _clean_text(body.get("Destination"))
    if destination:
        accumulator["destination"] = destination

    raw_type = body.get("Type") or body.get("TypeAndCargo") or body.get("ShipType")
    if raw_type is not None:
        accumulator["raw_type"] = raw_type

    nav_status = body.get("NavigationalStatus")
    if nav_status is not None:
        accumulator["navigational_status"] = _coerce_int(nav_status)
        accumulator["navigational_status_label"] = navigational_status_label(nav_status)

    rot = body.get("RateOfTurn")
    if rot is not None:
        accumulator["rate_of_turn"] = _coerce_int(rot)

    for field, target in (
        ("PositionAccuracy", "position_accuracy"),
        ("Raim", "raim"),
        ("SpecialManoeuvreIndicator", "special_manoeuvre_indicator"),
        ("Timestamp", "ais_timestamp"),
        ("CommunicationState", "communication_state"),
        ("Valid", "ais_valid"),
        ("AisVersion", "ais_version"),
        ("MaximumStaticDraught", "maximum_static_draught"),
        ("FixType", "fix_type"),
        ("Dte", "dte"),
        ("RepeatIndicator", "repeat_indicator"),
        ("MessageID", "message_id"),
        ("AssignedMode", "assigned_mode"),
        ("ClassBUnit", "class_b_unit"),
        ("ClassBDisplay", "class_b_display"),
        ("ClassBDsc", "class_b_dsc"),
        ("ClassBBand", "class_b_band"),
        ("ClassBMsg22", "class_b_msg22"),
        ("CommunicationStateIsItdma", "communication_state_is_itdma"),
        ("PartNumber", "part_number"),
    ):
        if field in body:
            value = body[field]
            if target in {"position_accuracy", "raim", "ais_valid", "dte", "assigned_mode", "class_b_unit", "class_b_display", "class_b_dsc", "class_b_band", "class_b_msg22", "communication_state_is_itdma", "part_number"}:
                accumulator[target] = _coerce_bool(value)
            elif target in {"maximum_static_draught"}:
                accumulator[target] = _coerce_float(value)
            elif target in {"ais_version", "special_manoeuvre_indicator", "ais_timestamp", "communication_state", "repeat_indicator", "message_id", "fix_type"}:
                accumulator[target] = _coerce_int(value)
            else:
                accumulator[target] = value

    dimensions = extract_dimensions(body)
    if dimensions:
        accumulator["dimensions"] = dimensions

    eta = extract_eta(body)
    if eta:
        accumulator["eta"] = eta

    report_b = body.get("ReportB")
    if isinstance(report_b, dict):
        accumulator["ais_messages"].setdefault(
            "StaticDataReport_ReportB",
            {"body": report_b, "metadata": metadata, "received_at": observed_at},
        )
        if not call_sign:
            cs = _clean_text(report_b.get("CallSign"))
            if cs:
                accumulator["call_sign"] = cs
        if raw_type is None and report_b.get("ShipType") is not None:
            accumulator["raw_type"] = report_b.get("ShipType")
        report_dims = extract_dimensions(report_b)
        if report_dims:
            accumulator["dimensions"] = report_dims


def finalize_vessel_record(
    accumulator: dict[str, Any],
    *,
    classify_ship_type,
    match_destination_to_port,
    find_nearest_ports,
) -> Optional[dict[str, Any]]:
    """Build API-facing vessel dict from accumulator; returns None if not mappable."""
    mmsi = _clean_text(accumulator.get("mmsi"))
    lat = accumulator.get("lat")
    lng = accumulator.get("lng")
    if not mmsi or lat is None or lng is None:
        return None

    ship_type_code, ship_type_label = classify_ship_type(accumulator.get("raw_type"))
    matched_port = match_destination_to_port(accumulator.get("destination") or "")
    if matched_port is None:
        nearest = find_nearest_ports(lat=lat, lng=lng, limit=1)
        matched_port = nearest[0] if nearest else None

    vessel_name = accumulator.get("vessel_name") or f"MMSI {mmsi}"
    record = {
        "id": f"ais:{mmsi}",
        "mmsi": mmsi,
        "vessel_name": vessel_name,
        "lat": lat,
        "lng": lng,
        "observed_at": accumulator.get("observed_at") or _now_iso(),
        "source_label": "AISStream",
        "source_url": "https://aisstream.io/documentation",
        "speed_knots": accumulator.get("speed_knots"),
        "course_over_ground": accumulator.get("course_over_ground"),
        "true_heading": accumulator.get("true_heading"),
        "ship_type_code": ship_type_code,
        "ship_type_label": ship_type_label,
        "call_sign": accumulator.get("call_sign"),
        "imo": accumulator.get("imo"),
        "destination": accumulator.get("destination"),
        "nearest_port": matched_port,
        "navigational_status": accumulator.get("navigational_status"),
        "navigational_status_label": accumulator.get("navigational_status_label"),
        "rate_of_turn": accumulator.get("rate_of_turn"),
        "position_accuracy": accumulator.get("position_accuracy"),
        "raim": accumulator.get("raim"),
        "special_manoeuvre_indicator": accumulator.get("special_manoeuvre_indicator"),
        "ais_timestamp": accumulator.get("ais_timestamp"),
        "communication_state": accumulator.get("communication_state"),
        "ais_valid": accumulator.get("ais_valid"),
        "ais_version": accumulator.get("ais_version"),
        "maximum_static_draught": accumulator.get("maximum_static_draught"),
        "fix_type": accumulator.get("fix_type"),
        "dte": accumulator.get("dte"),
        "repeat_indicator": accumulator.get("repeat_indicator"),
        "message_id": accumulator.get("message_id"),
        "assigned_mode": accumulator.get("assigned_mode"),
        "class_b_unit": accumulator.get("class_b_unit"),
        "class_b_display": accumulator.get("class_b_display"),
        "class_b_dsc": accumulator.get("class_b_dsc"),
        "class_b_band": accumulator.get("class_b_band"),
        "class_b_msg22": accumulator.get("class_b_msg22"),
        "communication_state_is_itdma": accumulator.get("communication_state_is_itdma"),
        "part_number": accumulator.get("part_number"),
        "raw_type": accumulator.get("raw_type"),
        "dimensions": accumulator.get("dimensions"),
        "eta": accumulator.get("eta"),
        "last_message_type": accumulator.get("last_message_type"),
        "last_message_at": accumulator.get("last_message_at"),
        "message_types_seen": list(accumulator.get("message_types_seen") or []),
        "ais_metadata": accumulator.get("ais_metadata") or {},
        "ais_messages": accumulator.get("ais_messages") or {},
    }
    return record
