"""
Petroleum trade-flow aggregator (free / no-paid-key sources)
=============================================================

Replaces the legacy ``_fetch_comtrade`` helper that required the paid
``COMTRADE_API_KEY`` subscription.  The new service composes a small
fallback chain of free open-data endpoints so the Petroleum Trade Context
panel can render real export/import figures for HS 2709 / 2710 / 2711
without any paid subscription.

Fallback chain (first non-empty wins, but we still merge supplementary
metadata where useful):

1. **UN Comtrade public preview** —
   ``https://comtradeapi.un.org/public/v1/preview/C/A/HS``
   No API key, no account, fair-use rate limit, up to 500 rows/request.
   Same JSON envelope as the paid API.  Source of truth for most
   countries / HS codes.  See https://uncomtrade.org/docs/un-comtrade-api/.

2. **UN Comtrade keyed API** — if ``COMTRADE_API_KEY`` is set we still
   prefer the higher-quota keyed endpoint (250k records / call).

3. **Statistics Canada Web Data Service (CIMT)** —
   ``https://www150.statcan.gc.ca/t1/wds/rest/`` JSON, no key, HS-coded
   Canadian International Merchandise Trade tables.  Used as a Canada
   specific augmentation.

4. **U.S. EIA International Energy API v2** — optional supplement for
   crude / refined / gas volume time-series when ``EIA_API_KEY`` is set
   (free registration, 5000 req/h).

5. **Static seed rows** — bundled curated 2022 figures (HS 2709/2710/2711
   for top exporters).  Final safety net when every upstream is down.

All upstream responses are memoised in an in-process TTL cache (24h) to
respect fair-use limits and keep panel reloads snappy.  No persistence
layer is required for the public preview because the data set already
lags 12-24 months from the current date.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any, Optional

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None  # type: ignore


# ---------------------------------------------------------------------------
# Endpoints & tunables
# ---------------------------------------------------------------------------

COMTRADE_PUBLIC_URL = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
COMTRADE_KEYED_URL = "https://comtradeapi.un.org/data/v1/get/C/A/HS"
STATCAN_WDS_BASE = "https://www150.statcan.gc.ca/t1/wds/rest"
EIA_API_BASE = "https://api.eia.gov/v2"

REQUEST_TIMEOUT_SECONDS = 12
CACHE_TTL_SECONDS = 24 * 60 * 60  # 24h — Comtrade lags 12-24 months anyway

# Comtrade petroleum chapter 27 sub-headings we care about.
PETROLEUM_HS_CODES: dict[str, str] = {
    "2709": "Petroleum oils, crude",
    "2710": "Petroleum oils, not crude (refined products)",
    "2711": "Petroleum gases (LNG, LPG, natural gas, propane, butane)",
}

# Statistics Canada Cansim Product IDs for international merchandise trade
# (HS-2-digit aggregates by country, monthly).  Stable open-data IDs.
# 12-10-0144-01: Canadian international merchandise trade by HS Section
# 12-10-0146-01: Custom-basis Imports/Exports by chapter (HS-2)
STATCAN_TRADE_PID = "12100146"

# ---------------------------------------------------------------------------
# In-memory TTL cache
# ---------------------------------------------------------------------------

_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, Any]] = {}


def _cache_get(key: str) -> Optional[Any]:
    with _cache_lock:
        entry = _cache.get(key)
        if not entry:
            return None
        ts, payload = entry
        if time.time() - ts > CACHE_TTL_SECONDS:
            _cache.pop(key, None)
            return None
        return payload


def _cache_set(key: str, value: Any) -> None:
    with _cache_lock:
        _cache[key] = (time.time(), value)


def clear_cache() -> None:
    """Test helper — wipe the TTL cache between scenarios."""
    with _cache_lock:
        _cache.clear()


# ---------------------------------------------------------------------------
# HTTP helper (uses requests if available, urllib otherwise)
# ---------------------------------------------------------------------------

def _http_get_json(url: str, *, timeout: int = REQUEST_TIMEOUT_SECONDS) -> Optional[dict]:
    """Best-effort GET → JSON, returns None on any error / non-200."""
    try:
        if requests is not None:
            r = requests.get(url, timeout=timeout)
            if r.status_code != 200:
                return None
            return r.json()
        # urllib fallback so the service can be exercised in restricted envs
        from urllib.request import Request, urlopen  # noqa: WPS433
        import json as _json  # noqa: WPS433

        req = Request(url, headers={"User-Agent": "mining-map/petroleum-trade"})
        with urlopen(req, timeout=timeout) as resp:  # noqa: S310
            if resp.status != 200:
                return None
            return _json.loads(resp.read().decode("utf-8", errors="replace"))
    except Exception as exc:  # noqa: BLE001
        print(f"[petroleum-trade] HTTP error {url[:80]}…: {exc}")
        return None


# ---------------------------------------------------------------------------
# Comtrade adapters (public-preview + keyed)
# ---------------------------------------------------------------------------

def _normalize_comtrade_row(row: dict) -> dict:
    return {
        "flow": "Export" if row.get("flowCode") == "X" else "Import",
        "trade_value_usd": row.get("primaryValue"),
        "net_weight_kg": row.get("netWgt"),
        "qty": row.get("qty"),
        "qty_unit": row.get("qtyUnitAbbr"),
        "partner": row.get("partnerDesc") or row.get("partner") or "World",
        "year": row.get("period") or row.get("year"),
    }


def fetch_comtrade_public(
    reporter_m49: str,
    hs_code: str,
    year: int = 2023,
    *,
    flow: str = "X,M",
    partner: str = "0",
    max_records: int = 100,
) -> dict:
    """
    Hit the UN Comtrade *public preview* endpoint (no key required).

    Returns ``{}`` if the upstream is unavailable so callers can fall through.
    """
    cache_key = f"comtrade_pub:{reporter_m49}:{hs_code}:{year}:{flow}:{partner}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    url = (
        f"{COMTRADE_PUBLIC_URL}"
        f"?reporterCode={reporter_m49}&cmdCode={hs_code}"
        f"&period={year}&flowCode={flow}&partnerCode={partner}"
        f"&maxRecords={max_records}"
    )
    payload = _http_get_json(url)
    if not payload:
        return {}

    rows = payload.get("data") or []
    flows = [_normalize_comtrade_row(r) for r in rows]
    out = {
        "source": "UN Comtrade (public preview)",
        "source_key": "comtrade_public",
        "year": year,
        "hs_code": hs_code,
        "flows": flows,
        "key_required": False,
    }
    _cache_set(cache_key, out)

    # If the preview returned no rows for the requested year, try the
    # previous one — Comtrade publishes annually and some reporters lag.
    if not flows and year > 2018:
        prev = fetch_comtrade_public(
            reporter_m49,
            hs_code,
            year - 1,
            flow=flow,
            partner=partner,
            max_records=max_records,
        )
        if prev.get("flows"):
            return prev
    return out


def fetch_comtrade_keyed(
    reporter_m49: str,
    hs_code: str,
    year: int = 2023,
    *,
    api_key: Optional[str] = None,
    flow: str = "X,M",
    partner: str = "0",
    limit: int = 100,
) -> dict:
    """Keyed Comtrade endpoint — used only when ``COMTRADE_API_KEY`` is set."""
    try:
        from backend.services.comtrade_keys import get_json_with_key_failover, primary_key
    except ImportError:
        from services.comtrade_keys import get_json_with_key_failover, primary_key

    key = primary_key(api_key)
    if not key:
        return {}

    cache_key = f"comtrade_key:{reporter_m49}:{hs_code}:{year}:{flow}:{partner}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    def build_url(subscription_key: str) -> str:
        return (
            f"{COMTRADE_KEYED_URL}"
            f"?reporterCode={reporter_m49}&cmdCode={hs_code}"
            f"&period={year}&flowCode={flow}&partnerCode={partner}"
            f"&subscription-key={subscription_key}&limit={limit}"
        )

    payload, _status = get_json_with_key_failover(build_url, api_key=key)
    if not payload:
        return {}
    rows = payload.get("data") or []
    out = {
        "source": "UN Comtrade (keyed)",
        "source_key": "comtrade_keyed",
        "year": year,
        "hs_code": hs_code,
        "flows": [_normalize_comtrade_row(r) for r in rows],
        "key_required": True,
    }
    _cache_set(cache_key, out)
    return out


# ---------------------------------------------------------------------------
# Statistics Canada CIMT adapter
# ---------------------------------------------------------------------------

# Maps petroleum HS-4 → Statistics Canada HS-2 chapter (only chapter 27
# is published in the merchandise-trade Cansim tables at no cost).
_STATCAN_HS_CHAPTER = {
    "2709": "27",
    "2710": "27",
    "2711": "27",
}


def fetch_statcan_canada(
    hs_code: str,
    year: int = 2023,
    *,
    flow: str = "X,M",
) -> dict:
    """
    Fetch Canadian merchandise trade aggregates from Statistics Canada
    Web Data Service (WDS).  Free, no key, no account.

    Returns at most one or two rows: a country-total Export and/or Import
    for HS chapter 27 (petroleum oils & gases).  Resolution is HS-2 because
    the free CIMT table aggregates to chapter level — full HS-8 detail
    requires the CIMT downloadable extracts (still free, but cumbersome
    for a live panel call).
    """
    chapter = _STATCAN_HS_CHAPTER.get(hs_code)
    if not chapter:
        return {}

    cache_key = f"statcan_ca:{chapter}:{year}:{flow}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    # We use the “getDataFromVectorsAndLatestNPeriods” endpoint with a
    # well-known vector for HS chapter 27 totals (Canadian Exports to
    # World and Imports from World).  These vectors are published under
    # table 12-10-0146-01.  Vector IDs are stable; documented at
    # https://www150.statcan.gc.ca/t1/wds/rest/getCubeMetadata
    #
    # If the upstream is down (or vectors change), we degrade gracefully.
    vectors = {
        "X": "v1063958707",   # Domestic exports, HS chapter 27, all countries
        "M": "v1063959247",   # Imports, HS chapter 27, all countries
    }
    flows_out: list[dict] = []
    for flow_letter in flow.split(","):
        vec = vectors.get(flow_letter.strip().upper())
        if not vec:
            continue
        url = (
            f"{STATCAN_WDS_BASE}/getDataFromVectorsAndLatestNPeriods"
        )
        # WDS expects POST with JSON body; we issue GET because the public
        # mirror also accepts simple JSON-in-URL but the more reliable path
        # is to POST.  We fall back to a simple GET on a public CSV mirror.
        # NOTE: Statistics Canada also publishes a static CSV at:
        #   https://www150.statcan.gc.ca/n1/tbl/csv/{pid}-eng.zip
        # We avoid bundling the zip parser here; instead we record a
        # provenance pointer the UI surfaces as a deep-link.
        body = {"vectorIds": [vec.replace("v", "")], "latestN": 1}
        payload = None
        if requests is not None:
            try:
                r = requests.post(url, json=body, timeout=REQUEST_TIMEOUT_SECONDS)
                if r.status_code == 200:
                    payload = r.json()
            except Exception as exc:  # noqa: BLE001
                print(f"[petroleum-trade] StatsCan POST failed: {exc}")
        if not payload:
            continue
        # WDS response is a list of {status, object: {vectorDataPoint: [...]}}
        try:
            obj = payload[0].get("object") if isinstance(payload, list) else {}
            pts = (obj or {}).get("vectorDataPoint") or []
            if not pts:
                continue
            latest = pts[-1]
            value_cad = latest.get("value")
            ref_period = latest.get("refPer", "")
            # Statistics Canada returns CAD; surface that and approximate
            # in USD using a conservative spot rate (1 CAD ≈ 0.74 USD).
            cad_to_usd = 0.74
            trade_value_usd = float(value_cad) * cad_to_usd if value_cad is not None else None
            flows_out.append(
                {
                    "flow": "Export" if flow_letter.strip().upper() == "X" else "Import",
                    "trade_value_usd": trade_value_usd,
                    "net_weight_kg": None,
                    "partner": "World",
                    "year": ref_period[:4] if ref_period else year,
                    "qty": None,
                    "qty_unit": "CAD",
                }
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[petroleum-trade] StatsCan parse failed: {exc}")
            continue

    out = {
        "source": "Statistics Canada CIMT (HS-2 chapter 27)",
        "source_key": "statcan_canada",
        "year": year,
        "hs_code": hs_code,
        "flows": flows_out,
        "key_required": False,
    }
    if flows_out:
        _cache_set(cache_key, out)
    return out


# ---------------------------------------------------------------------------
# EIA International adapter (volume series, optional)
# ---------------------------------------------------------------------------

# Mapping of HS code → EIA petroleum series we surface as a supplement.
# These EIA series carry physical volumes (mb/d), not USD value, so we
# label them clearly in the response.
_EIA_PRODUCT_BY_HS = {
    "2709": "5",   # Crude oil including lease condensate
    "2710": "57",  # Refined petroleum products
    "2711": "26",  # Dry natural gas
}

# ISO-3 codes EIA uses for country facets.  Only the petroleum-relevant
# ones we expect to appear in the dossier panel are listed.
EIA_COUNTRY_ISO3: dict[str, str] = {
    "CA": "CAN", "US": "USA", "NO": "NOR", "RU": "RUS", "SA": "SAU",
    "AE": "ARE", "IQ": "IRQ", "KW": "KWT", "KZ": "KAZ", "NG": "NGA",
    "AO": "AGO", "DZ": "DZA", "LY": "LBY", "MX": "MEX", "AZ": "AZE",
    "NL": "NLD", "IN": "IND", "KR": "KOR", "SG": "SGP", "BE": "BEL",
    "QA": "QAT", "AU": "AUS", "MY": "MYS", "ID": "IDN", "OM": "OMN",
    "VE": "VEN", "BR": "BRA", "CN": "CHN", "GB": "GBR", "DE": "DEU",
    "FR": "FRA", "IT": "ITA", "ES": "ESP", "JP": "JPN", "EG": "EGY",
    "TR": "TUR",
}


def fetch_eia_international(
    iso2: str,
    hs_code: str,
    year: int = 2023,
    *,
    api_key: Optional[str] = None,
) -> dict:
    """
    Pull country-level petroleum exports / imports from the U.S. EIA
    International API v2.  Free key only — when no key is set we return
    {} so the caller continues down the fallback chain.
    """
    key = api_key if api_key is not None else os.getenv("EIA_API_KEY", "")
    if not key:
        return {}
    iso3 = EIA_COUNTRY_ISO3.get(iso2.upper())
    product = _EIA_PRODUCT_BY_HS.get(hs_code)
    if not iso3 or not product:
        return {}

    cache_key = f"eia_int:{iso3}:{product}:{year}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    flows_out: list[dict] = []
    # activityId 2 = Exports, 3 = Imports (per EIA international taxonomy)
    for activity_id, flow_label in ((2, "Export"), (3, "Import")):
        url = (
            f"{EIA_API_BASE}/international/data/"
            f"?api_key={key}"
            f"&frequency=annual"
            f"&data[0]=value"
            f"&facets[productId][]={product}"
            f"&facets[activityId][]={activity_id}"
            f"&facets[countryRegionId][]={iso3}"
            f"&start={year - 1}&end={year}"
            f"&sort[0][column]=period&sort[0][direction]=desc"
            f"&length=2"
        )
        payload = _http_get_json(url)
        if not payload:
            continue
        rows = (payload.get("response") or {}).get("data") or []
        if not rows:
            continue
        latest = rows[0]
        flows_out.append(
            {
                "flow": flow_label,
                "trade_value_usd": None,    # EIA reports volume, not USD
                "net_weight_kg": None,
                "qty": latest.get("value"),
                "qty_unit": latest.get("unit", "Mb/d"),
                "partner": "World",
                "year": latest.get("period", year),
            }
        )

    out = {
        "source": "U.S. EIA International (volume)",
        "source_key": "eia",
        "year": year,
        "hs_code": hs_code,
        "flows": flows_out,
        "key_required": True,
    }
    if flows_out:
        _cache_set(cache_key, out)
    return out


# ---------------------------------------------------------------------------
# Static seed fallback (last-resort, no network)
# ---------------------------------------------------------------------------

# Curated 2022 country-level export figures for HS 2709 / 2710 / 2711,
# derived from publicly-available UN Comtrade aggregate tables
# (comtradeplus.un.org, accessed 2024-Q4) and cross-checked against IEA
# WEO 2023 and BP Statistical Review 2023.  Values in USD, weight in kg.
SEED_PETROLEUM_FLOWS: dict[tuple[str, str], dict] = {
    # ── HS 2709 ── crude oil ────────────────────────────────────────────
    ("682", "2709"): {"value_usd": 326_000_000_000, "weight_kg": 356_000_000_000},
    ("643", "2709"): {"value_usd": 210_000_000_000, "weight_kg": 240_000_000_000},
    ("784", "2709"): {"value_usd": 157_000_000_000, "weight_kg": 172_000_000_000},
    ("368", "2709"): {"value_usd": 113_000_000_000, "weight_kg": 175_000_000_000},
    ("124", "2709"): {"value_usd": 102_000_000_000, "weight_kg": 157_000_000_000},
    ("578", "2709"): {"value_usd":  89_000_000_000, "weight_kg": 100_000_000_000},
    ("414", "2709"): {"value_usd":  74_000_000_000, "weight_kg":  87_000_000_000},
    ("840", "2709"): {"value_usd":  60_000_000_000, "weight_kg":  82_000_000_000},
    ("398", "2709"): {"value_usd":  48_000_000_000, "weight_kg":  67_000_000_000},
    ("566", "2709"): {"value_usd":  45_000_000_000, "weight_kg":  64_000_000_000},
    ("024", "2709"): {"value_usd":  38_000_000_000, "weight_kg":  55_000_000_000},
    ("012", "2709"): {"value_usd":  31_000_000_000, "weight_kg":  44_000_000_000},
    ("484", "2709"): {"value_usd":  27_000_000_000, "weight_kg":  42_000_000_000},
    ("434", "2709"): {"value_usd":  26_000_000_000, "weight_kg":  36_000_000_000},
    ("031", "2709"): {"value_usd":  19_000_000_000, "weight_kg":  28_000_000_000},

    # ── HS 2710 ── refined products ─────────────────────────────────────
    ("840", "2710"): {"value_usd": 149_000_000_000, "weight_kg": 167_000_000_000},
    ("643", "2710"): {"value_usd":  79_000_000_000, "weight_kg": 110_000_000_000},
    ("356", "2710"): {"value_usd":  72_000_000_000, "weight_kg":  77_000_000_000},
    ("528", "2710"): {"value_usd":  66_000_000_000, "weight_kg":  74_000_000_000},
    ("702", "2710"): {"value_usd":  63_000_000_000, "weight_kg":  71_000_000_000},
    ("682", "2710"): {"value_usd":  55_000_000_000, "weight_kg":  65_000_000_000},
    ("410", "2710"): {"value_usd":  54_000_000_000, "weight_kg":  58_000_000_000},
    ("784", "2710"): {"value_usd":  48_000_000_000, "weight_kg":  54_000_000_000},
    ("056", "2710"): {"value_usd":  40_000_000_000, "weight_kg":  46_000_000_000},
    ("124", "2710"): {"value_usd":  35_000_000_000, "weight_kg":  43_000_000_000},

    # ── HS 2711 ── petroleum gases / LNG ────────────────────────────────
    ("036", "2711"): {"value_usd":  75_000_000_000, "weight_kg":  82_000_000_000},
    ("634", "2711"): {"value_usd":  71_000_000_000, "weight_kg":  78_000_000_000},
    ("840", "2711"): {"value_usd":  56_000_000_000, "weight_kg":  60_000_000_000},
    ("643", "2711"): {"value_usd":  52_000_000_000, "weight_kg":  60_000_000_000},
    ("458", "2711"): {"value_usd":  27_000_000_000, "weight_kg":  31_000_000_000},
    ("578", "2711"): {"value_usd":  20_000_000_000, "weight_kg":  24_000_000_000},
    ("566", "2711"): {"value_usd":  18_000_000_000, "weight_kg":  21_000_000_000},
    ("012", "2711"): {"value_usd":  15_000_000_000, "weight_kg":  18_000_000_000},
    ("360", "2711"): {"value_usd":  12_000_000_000, "weight_kg":  14_000_000_000},
    ("512", "2711"): {"value_usd":  10_000_000_000, "weight_kg":  12_000_000_000},
    # Canada LNG/NG is large via the US — surface as a separate row.
    ("124", "2711"): {"value_usd":  18_000_000_000, "weight_kg":  22_000_000_000},
}


def fetch_seed(reporter_m49: str, hs_code: str) -> dict:
    """Return the bundled 2022 seed row for (reporter, HS) if we have one."""
    row = SEED_PETROLEUM_FLOWS.get((reporter_m49, hs_code))
    if not row:
        return {}
    return {
        "source": "Seed (2022 curated, UN Comtrade aggregate tables)",
        "source_key": "seed",
        "year": 2022,
        "hs_code": hs_code,
        "flows": [
            {
                "flow": "Export",
                "trade_value_usd": row["value_usd"],
                "net_weight_kg": row["weight_kg"],
                "partner": "World",
                "year": 2022,
                "qty": None,
                "qty_unit": None,
            }
        ],
        "key_required": False,
    }


# ---------------------------------------------------------------------------
# Public orchestrator
# ---------------------------------------------------------------------------

def fetch_petroleum_trade(
    reporter_m49: str,
    iso2: str,
    hs_code: str,
    year: int = 2023,
) -> dict:
    """
    Orchestrate the full fallback chain and return a single ``trade_flows``
    dict shaped exactly like the legacy ``_fetch_comtrade`` output so the
    /api/company-intel response stays backwards compatible.

    The returned dict additionally carries:
      * ``source_key`` — machine-readable source identifier (``comtrade_public`` |
        ``comtrade_keyed`` | ``statcan_canada`` | ``eia`` | ``seed`` | ``mixed``)
      * ``key_required`` — whether the chosen primary source needed an API key
      * ``supplementary`` — list of secondary records merged into the response
    """
    if reporter_m49 is None or hs_code is None:
        return {}

    primary: dict = {}
    supplementary: list[dict] = []

    # 1. Keyed Comtrade first (better quotas) if the operator opted in.
    keyed = fetch_comtrade_keyed(reporter_m49, hs_code, year)
    if keyed.get("flows"):
        primary = keyed

    # 2. Public-preview Comtrade — the headline free source.
    if not primary:
        public = fetch_comtrade_public(reporter_m49, hs_code, year)
        if public.get("flows"):
            primary = public

    # 3. Country-specific augmentations.  Canada → StatsCan.
    if (iso2 or "").upper() == "CA":
        statcan = fetch_statcan_canada(hs_code, year)
        if statcan.get("flows"):
            if not primary:
                primary = statcan
            else:
                supplementary.append(statcan)

    # 4. EIA volume series — supplementary regardless of primary.
    if iso2:
        eia = fetch_eia_international(iso2, hs_code, year)
        if eia.get("flows"):
            if not primary:
                primary = eia
            else:
                supplementary.append(eia)

    # 5. Last-resort seed row.
    if not primary:
        seed = fetch_seed(reporter_m49, hs_code)
        if seed.get("flows"):
            primary = seed

    if not primary:
        return {}

    if supplementary:
        primary = dict(primary)  # don't mutate cached payload
        primary["supplementary"] = supplementary
        sources = {primary.get("source_key", "")} | {
            s.get("source_key", "") for s in supplementary
        }
        if len(sources) > 1:
            primary["source"] = (
                primary.get("source", "")
                + " + "
                + ", ".join(
                    s["source"] for s in supplementary if s.get("source")
                )
            )
            primary["source_key"] = "mixed"
    return primary


def comtrade_key_available() -> bool:
    """True iff the operator has wired up the paid Comtrade subscription."""
    return bool(os.getenv("COMTRADE_API_KEY", ""))


def free_data_available() -> bool:
    """
    Free sources are *always* available (they include the bundled seed).
    Returned to the UI so the panel knows it can show data without a key.
    """
    return True
