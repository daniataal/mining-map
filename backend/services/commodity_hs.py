"""Shared commodity label → HS code mapping for trade and country snapshots."""

from __future__ import annotations

from typing import Optional

# HS chapter 27 petroleum codes synced by comtrade worker
HS27_CODES = ("2709", "2710", "2711")

COMMODITY_HS: dict[str, str] = {
    "gold": "7108",
    "silver": "7106",
    "diamond": "7102",
    "diamonds": "7102",
    "platinum": "7110",
    "palladium": "7110",
    "copper": "7403",
    "iron ore": "2601",
    "iron": "2601",
    "coal": "2701",
    "bauxite": "2606",
    "aluminium": "7601",
    "aluminum": "7601",
    "manganese": "2602",
    "chromite": "2610",
    "chrome": "2610",
    "cobalt": "2605",
    "lithium": "2825",
    "nickel": "7502",
    "zinc": "7901",
    "lead": "7801",
    "tin": "8001",
    "tungsten": "2611",
    "titanium": "2614",
    "tantalum": "2615",
    "coltan": "2615",
    "uranium": "2612",
    "crude oil": "2709",
    "crude petroleum": "2709",
    "petroleum": "2709",
    "oil": "2709",
    "petroleum products": "2710",
    "refined petroleum": "2710",
    "refined products": "2710",
    "gasoline": "2710",
    "diesel": "2710",
    "fuel oil": "2710",
    "natural gas": "2711",
    "lng": "2711",
    "lpg": "2711",
    "petroleum gas": "2711",
    "petroleum gases": "2711",
}


def resolve_hs(commodity: str) -> Optional[str]:
    """Map commodity string to primary HS-4 code."""
    key = (commodity or "").strip().lower()
    if not key:
        return None
    if key in COMMODITY_HS:
        return COMMODITY_HS[key]
    for token, hs in COMMODITY_HS.items():
        if token in key or key in token:
            return hs
    return None


def hs_codes_for_entity(commodity: str) -> list[str]:
    """HS codes to query for a license commodity (petroleum may expand to chapter 27 bundle)."""
    hs = resolve_hs(commodity)
    if hs and hs.startswith("27"):
        return [hs]
    if hs:
        return [hs]
    commodity_l = (commodity or "").lower()
    if any(tok in commodity_l for tok in ("oil", "petroleum", "gas", "lng", "lpg", "crude", "diesel")):
        return list(HS27_CODES)
    return []
