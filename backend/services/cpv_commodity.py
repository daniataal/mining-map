"""CPV code → commodity bucket mapping for EU TED procurement facets."""

from __future__ import annotations

from typing import Optional

# CPV division 091* — petroleum, natural gas, mining (EU standard).
CPV_COMMODITY_BUCKETS: dict[str, tuple[str, ...]] = {
    "petroleum": (
        "0910",
        "09100000",
        "09110000",
        "09111000",
        "09112000",
        "09113000",
        "09114000",
        "09115000",
        "09116000",
        "09117000",
        "09118000",
        "09119000",
    ),
    "mining": (
        "0912",
        "09120000",
        "09121000",
        "09122000",
        "09123000",
        "09124000",
        "09125000",
        "09126000",
        "09127000",
        "09128000",
        "09129000",
        "0913",
        "09130000",
        "09131000",
        "09132000",
        "09133000",
        "09134000",
        "09135000",
        "09136000",
        "09137000",
        "09138000",
        "09139000",
    ),
    "metals": (
        "0914",
        "09140000",
        "147",
        "14700000",
        "145",
        "14500000",
        "146",
        "14600000",
        "148",
        "14800000",
        "149",
        "14900000",
    ),
}

BUCKET_LABELS: dict[str, str] = {
    "petroleum": "Petroleum & natural gas (CPV 0910*)",
    "mining": "Mining & quarrying (CPV 0912–0913*)",
    "metals": "Metals & ores (CPV 0914*, 14*)",
}


def license_commodity_to_cpv_bucket(
    commodity: Optional[str],
    *,
    license_type: Optional[str] = None,
) -> Optional[str]:
    """Map license commodity / type to TED CPV bucket (mining, metals, petroleum)."""
    text = f"{commodity or ''} {license_type or ''}".strip().lower()
    if not text:
        return None
    petroleum_tokens = (
        "petroleum",
        "oil",
        "gas",
        "lng",
        "lpg",
        "crude",
        "hydrocarbon",
        "natural gas",
        "fuel",
    )
    metals_tokens = (
        "gold",
        "silver",
        "copper",
        "zinc",
        "nickel",
        "iron",
        "lithium",
        "cobalt",
        "manganese",
        "platinum",
        "palladium",
        "uranium",
        "ore",
        "metal",
    )
    mining_tokens = ("mining", "mineral", "coal", "quarry", "aggregate", "gravel", "sand")
    if any(tok in text for tok in petroleum_tokens):
        return "petroleum"
    if any(tok in text for tok in metals_tokens):
        return "metals"
    if any(tok in text for tok in mining_tokens):
        return "mining"
    return None


def normalize_cpv_bucket(bucket: Optional[str]) -> Optional[str]:
    if not bucket:
        return None
    key = bucket.strip().lower()
    return key if key in CPV_COMMODITY_BUCKETS else None


def cpv_matches_bucket(cpv: str, bucket: str) -> bool:
    """True when any CPV code in the notice matches the bucket prefixes."""
    normalized = normalize_cpv_bucket(bucket)
    if not normalized:
        return False
    prefixes = CPV_COMMODITY_BUCKETS[normalized]
    text = (cpv or "").replace(" ", "")
    if not text:
        return False
    for code in text.split(","):
        code = code.strip()
        if not code:
            continue
        for prefix in prefixes:
            if code.startswith(prefix):
                return True
    return False


def sql_cpv_bucket_clause(bucket: str) -> tuple[str, list[str]]:
    """
    Build SQL OR clause matching CPV column against bucket prefixes.
    Returns (clause_fragment, prefix_values) where prefix_values are like '0912%'.
    """
    normalized = normalize_cpv_bucket(bucket)
    if not normalized:
        return "1=1", []
    prefixes = CPV_COMMODITY_BUCKETS[normalized]
    parts: list[str] = []
    values: list[str] = []
    for prefix in prefixes:
        parts.append(f"cpv LIKE %s")
        values.append(f"{prefix}%")
    return f"({' OR '.join(parts)})", values
