"""Classify OSM pipeline features by transported substance (oil, gas, water, other)."""

from __future__ import annotations

import re
from typing import Any, Literal

PipelineSubstance = Literal["oil", "gas", "water", "other", "unknown"]

_SUBSTANCE_TAG_MAP: dict[str, PipelineSubstance] = {
    "oil": "oil",
    "crude": "oil",
    "crude_oil": "oil",
    "petroleum": "oil",
    "gas": "gas",
    "natural_gas": "gas",
    "lng": "gas",
    "lpg": "gas",
    "methane": "gas",
    "water": "water",
    "drinking_water": "water",
    "wastewater": "water",
    "sewage": "water",
}

_TYPE_TAG_MAP: dict[str, PipelineSubstance] = {
    "oil": "oil",
    "gas": "gas",
    "water": "water",
}

# Name/description keyword hints (lowercase); checked after explicit tags.
_OIL_KEYWORDS = re.compile(
    r"\b(oil|crude|petroleum|pipeline\s+oil|نفط|נפט)\b",
    re.IGNORECASE,
)
_GAS_KEYWORDS = re.compile(
    r"\b(natural\s+gas|lng|lpg|methane|gas\s+pipeline|גז)\b",
    re.IGNORECASE,
)
_WATER_KEYWORDS = re.compile(
    r"(مياه|מים|water|wasser|eau|aqueduct|irrigation|sewer|sewage|wastewater|"
    r"drinking\s+water|water\s+main|watermain|water\s+supply|water\s+project)",
    re.IGNORECASE,
)


def _norm_tag(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().lower().replace(" ", "_")


def _name_haystack(tags: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ("name", "name:en", "name:ar", "name:he", "description", "ref"):
        raw = tags.get(key)
        if raw is not None and str(raw).strip():
            parts.append(str(raw))
    return " ".join(parts)


def classify_pipeline_substance(tags: dict[str, Any]) -> PipelineSubstance:
    """Infer oil | gas | water | other | unknown from OSM tags and names."""
    substance_raw = _norm_tag(tags.get("substance"))
    if substance_raw:
        mapped = _SUBSTANCE_TAG_MAP.get(substance_raw)
        if mapped:
            return mapped
        if substance_raw in _SUBSTANCE_TAG_MAP.values():
            return substance_raw  # type: ignore[return-value]

    type_raw = _norm_tag(tags.get("type"))
    if type_raw:
        mapped = _TYPE_TAG_MAP.get(type_raw)
        if mapped:
            return mapped

    usage = _norm_tag(tags.get("usage"))
    if usage in {"water", "drinking_water", "irrigation"}:
        return "water"
    if usage in {"oil", "gas"}:
        return usage  # type: ignore[return-value]

    haystack = _name_haystack(tags)
    if haystack:
        water_hit = bool(_WATER_KEYWORDS.search(haystack))
        oil_hit = bool(_OIL_KEYWORDS.search(haystack))
        gas_hit = bool(_GAS_KEYWORDS.search(haystack))
        if water_hit and not oil_hit and not gas_hit:
            return "water"
        if gas_hit and not water_hit and not oil_hit:
            return "gas"
        if oil_hit and not water_hit and not gas_hit:
            return "oil"
        if water_hit:
            return "water"

    if tags.get("man_made") == "pipeline":
        return "unknown"
    return "unknown"
