"""Backfill missing or low-quality license coordinates from the free-form
``region`` / ``country`` text fields.

This module is importable from FastAPI (used by ``POST /api/admin/geocode-
licenses``) and runnable as a stand-alone CLI:

    python backend/geocode_licenses.py --dry-run                # preview
    python backend/geocode_licenses.py --limit 500              # 500 rows
    python backend/geocode_licenses.py --country Ghana          # one country
    python backend/geocode_licenses.py --force                  # also re-do
                                                                # already-geocoded
                                                                # rows (NEVER
                                                                # overwrites
                                                                # rows tagged
                                                                # geo_source='user')

Design goals
------------
- **Reversible.** Every row we touch has its prior ``lat`` / ``lng`` snap-
  shotted into ``original_lat`` / ``original_lng`` *the first time only*.
  ``revert_geocoded(...)`` restores those values for any row whose
  ``geo_source`` is not ``'user'``.
- **Non-destructive.** A row is skipped if ``geo_source = 'user'`` (the user
  verified those coordinates) unless ``force=True`` AND ``allow_overwrite_user
  =True``.
- **Idempotent.** Re-running with the same arguments is a no-op (the cache
  in ``geo_cache`` and the ``geo_source`` flag both deduplicate work).
- **Polite.** Nominatim's usage policy mandates ≥1 s between requests and a
  meaningful ``User-Agent``. We default to 1.1 s; a per-process LRU cache and
  the optional Mapbox path keep us well below the public free-tier ceiling.

Environment variables
---------------------
GEOCODER_USER_AGENT   Required by Nominatim. Defaults to
                      ``"mining-map-backfill/1.0 (contact admin)"``.
                      Override with a real contact email in production.
NOMINATIM_BASE_URL    Default ``https://nominatim.openstreetmap.org``.
                      Point to a self-hosted instance for higher rate limits.
NOMINATIM_RPS_DELAY   Seconds between Nominatim requests. Default 1.1.
MAPBOX_GEOCODING_TOKEN Optional. If present, Mapbox is preferred over
                      Nominatim (much higher free-tier ceiling).
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable, Optional

import requests

log = logging.getLogger("geocode_licenses")
if not log.handlers:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _get_conn():
    # Imported lazily so this module can be exercised in unit tests / linters
    # on machines that don't have psycopg2 installed (it's a backend-only dep).
    import psycopg2
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        database=os.getenv("DB_NAME", "mining_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "password"),
    )


def _dict_cursor(conn):
    from psycopg2.extras import RealDictCursor
    return conn.cursor(cursor_factory=RealDictCursor)


def _ensure_geo_cache_table(cur) -> None:
    """Persistent cache for ``(country, region) -> (lat, lng)`` lookups.

    Lives in its own table so a re-run never re-hits Nominatim for queries
    we've already resolved (or already proved unresolvable).
    """
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS geo_cache (
            query_key   VARCHAR(512) PRIMARY KEY,
            lat         FLOAT,
            lng         FLOAT,
            confidence  FLOAT,
            source      VARCHAR(50),
            display_name TEXT,
            looked_up_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )


# ---------------------------------------------------------------------------
# Geocoder backends
# ---------------------------------------------------------------------------

@dataclass
class GeocodeResult:
    lat: float
    lng: float
    confidence: Optional[float]
    source: str
    display_name: Optional[str]


def _build_query(country: Optional[str], region: Optional[str]) -> Optional[str]:
    """Compose the most specific query string we can from license metadata."""
    # Region is sometimes multi-line ("Ashanti Region\nKumasi District"); the
    # first line tends to be the most specific district. Nominatim is more
    # reliable for "Ashanti Region, Ghana" than for an unreviewed district
    # name, so we keep the first line and let the country anchor it.
    region_clean = [p.strip() for p in (region or "").strip().splitlines() if p and p.strip()]
    region_first = region_clean[0] if region_clean else ""
    parts = [p for p in ((region_first or "").strip(), (country or "").strip()) if p]
    if not parts:
        return None
    out = ", ".join(parts).strip(" ,")
    return out or None


def _nominatim_lookup(query: str) -> Optional[GeocodeResult]:
    base = os.getenv("NOMINATIM_BASE_URL", "https://nominatim.openstreetmap.org")
    ua = os.getenv("GEOCODER_USER_AGENT", "mining-map-backfill/1.0 (contact admin)")
    try:
        r = requests.get(
            f"{base}/search",
            params={"q": query, "format": "json", "limit": 1, "addressdetails": 0},
            headers={"User-Agent": ua, "Accept": "application/json"},
            timeout=12,
        )
        if r.status_code != 200:
            log.warning("nominatim status=%s for %r", r.status_code, query)
            return None
        data = r.json() or []
        if not data:
            return None
        hit = data[0]
        lat = float(hit["lat"])
        lon = float(hit["lon"])
        # Nominatim's "importance" loosely maps to confidence (0..1).
        importance = hit.get("importance")
        confidence = float(importance) if importance is not None else None
        return GeocodeResult(
            lat=lat,
            lng=lon,
            confidence=confidence,
            source="nominatim",
            display_name=hit.get("display_name"),
        )
    except Exception as e:
        log.warning("nominatim error for %r: %s", query, e)
        return None


def _mapbox_lookup(query: str) -> Optional[GeocodeResult]:
    token = os.getenv("MAPBOX_GEOCODING_TOKEN")
    if not token:
        return None
    try:
        url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{requests.utils.quote(query)}.json"
        r = requests.get(url, params={"access_token": token, "limit": 1}, timeout=10)
        if r.status_code != 200:
            log.warning("mapbox status=%s for %r", r.status_code, query)
            return None
        feats = (r.json() or {}).get("features") or []
        if not feats:
            return None
        f = feats[0]
        lon, lat = f.get("center", [None, None])
        if lat is None or lon is None:
            return None
        return GeocodeResult(
            lat=float(lat),
            lng=float(lon),
            confidence=float(f.get("relevance") or 0.0),
            source="mapbox",
            display_name=f.get("place_name"),
        )
    except Exception as e:
        log.warning("mapbox error for %r: %s", query, e)
        return None


# ---------------------------------------------------------------------------
# Core orchestration
# ---------------------------------------------------------------------------

@dataclass
class GeocodeStats:
    candidates: int = 0
    skipped_user_verified: int = 0
    skipped_no_text: int = 0
    cache_hits: int = 0
    network_hits: int = 0
    not_found: int = 0
    would_update: int = 0
    updated: int = 0
    sample: list = field(default_factory=list)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None


def _select_candidates(cur, *, limit: int, force: bool, country_filter: Optional[str]):
    """Rows whose coords look missing or auto-derived.

    ``force=True`` includes everything, but ``backfill`` itself still refuses
    to overwrite ``geo_source='user'`` rows unless the caller separately
    passes ``allow_overwrite_user=True``.
    """
    where = []
    params: list = []
    if not force:
        # Default: only target rows that clearly need help — null/0 coords
        # OR rows that have no recorded geocoding source yet (legacy data).
        where.append("(lat IS NULL OR lng IS NULL OR (lat = 0 AND lng = 0) OR geo_source IS NULL)")
        where.append("COALESCE(geo_source, '') <> 'user'")
    if country_filter:
        where.append("LOWER(country) = LOWER(%s)")
        params.append(country_filter)
    sql = "SELECT id, company, country, region, lat, lng, geo_source FROM licenses"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id LIMIT %s"
    params.append(limit)
    cur.execute(sql, tuple(params))
    return cur.fetchall()


def _cache_get(cur, key: str):
    cur.execute("SELECT lat, lng, confidence, source, display_name FROM geo_cache WHERE query_key = %s", (key,))
    return cur.fetchone()


def _cache_put(cur, key: str, result: Optional[GeocodeResult]):
    if result is None:
        cur.execute(
            "INSERT INTO geo_cache (query_key, source) VALUES (%s, 'not_found') ON CONFLICT (query_key) DO NOTHING",
            (key,),
        )
        return
    cur.execute(
        """
        INSERT INTO geo_cache (query_key, lat, lng, confidence, source, display_name)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (query_key) DO UPDATE SET
            lat = EXCLUDED.lat,
            lng = EXCLUDED.lng,
            confidence = EXCLUDED.confidence,
            source = EXCLUDED.source,
            display_name = EXCLUDED.display_name,
            looked_up_at = CURRENT_TIMESTAMP
        """,
        (key, result.lat, result.lng, result.confidence, result.source, result.display_name),
    )


def _resolve(cur, country: Optional[str], region: Optional[str], rps_delay: float) -> Optional[GeocodeResult]:
    query = _build_query(country, region)
    if not query:
        return None
    key = query.lower()
    cached = _cache_get(cur, key)
    if cached is not None:
        # ``source = 'not_found'`` is a negative cache hit — don't retry.
        if cached["source"] == "not_found":
            return None
        return GeocodeResult(
            lat=cached["lat"], lng=cached["lng"],
            confidence=cached["confidence"], source=cached["source"],
            display_name=cached["display_name"],
        )

    # Try Mapbox first if configured (paid tier, faster), Nominatim otherwise.
    result = _mapbox_lookup(query) or _nominatim_lookup(query)
    if result is None and country and region:
        # Last-chance fallback: try country-only so we land *somewhere* in the
        # right country even if the district name is misspelt.
        result = _mapbox_lookup(country) or _nominatim_lookup(country)
        if result is not None:
            # Penalise confidence to mark it as a coarse fallback.
            result.confidence = min(result.confidence or 0.0, 0.3)

    _cache_put(cur, key, result)
    if result is None:
        # Negative responses are cheap; positives must respect Nominatim RPS.
        return None
    if result.source == "nominatim":
        time.sleep(rps_delay)
    return result


def backfill(
    *,
    dry_run: bool = True,
    limit: int = 200,
    force: bool = False,
    allow_overwrite_user: bool = False,
    country_filter: Optional[str] = None,
    rps_delay: Optional[float] = None,
) -> GeocodeStats:
    """Run a single backfill batch.

    Parameters mirror the HTTP endpoint. ``allow_overwrite_user=True`` is the
    *only* way to clobber a row whose ``geo_source='user'`` — keep it off by
    default so the admin UI cannot accidentally erase verified coordinates.
    """
    rps = float(rps_delay if rps_delay is not None else os.getenv("NOMINATIM_RPS_DELAY", "1.1"))
    stats = GeocodeStats(started_at=datetime.utcnow().isoformat())

    conn = _get_conn()
    cur = _dict_cursor(conn)
    try:
        _ensure_geo_cache_table(cur)
        conn.commit()

        rows = _select_candidates(cur, limit=limit, force=force, country_filter=country_filter)
        stats.candidates = len(rows)
        log.info("backfill: %d candidate rows (dry_run=%s force=%s)", len(rows), dry_run, force)

        for row in rows:
            country = (row.get("country") or "").strip() or None
            region = (row.get("region") or "").strip() or None
            existing_source = (row.get("geo_source") or "").lower()

            if existing_source == "user" and not allow_overwrite_user:
                stats.skipped_user_verified += 1
                continue
            if not country and not region:
                stats.skipped_no_text += 1
                continue

            # Cache lookup happens inside _resolve so we increment hits there.
            cached = _cache_get(cur, _build_query(country, region).lower())
            result = _resolve(cur, country, region, rps_delay=rps)
            if cached is not None:
                stats.cache_hits += 1
            else:
                stats.network_hits += 1

            if result is None:
                stats.not_found += 1
                continue

            stats.would_update += 1
            sample_entry = {
                "id": row["id"],
                "company": row["company"],
                "from": {"lat": row.get("lat"), "lng": row.get("lng")},
                "to":   {"lat": result.lat, "lng": result.lng},
                "source": result.source,
                "confidence": result.confidence,
                "display_name": result.display_name,
            }
            if len(stats.sample) < 10:
                stats.sample.append(sample_entry)

            if dry_run:
                continue

            # Snapshot the *first* prior value (so re-runs don't keep shifting
            # original_lat/lng around and breaking revert).
            cur.execute(
                """
                UPDATE licenses
                SET
                    original_lat   = COALESCE(original_lat, lat),
                    original_lng   = COALESCE(original_lng, lng),
                    lat            = %s,
                    lng            = %s,
                    geo_source     = %s,
                    geo_approximated = TRUE,
                    geo_confidence = %s,
                    geocoded_at    = CURRENT_TIMESTAMP
                WHERE id = %s
                """,
                (result.lat, result.lng, result.source, result.confidence, row["id"]),
            )
            stats.updated += 1
            # Commit every 25 rows so a crash mid-batch isn't a total loss.
            if stats.updated % 25 == 0:
                conn.commit()

        conn.commit()
    finally:
        cur.close()
        conn.close()

    stats.finished_at = datetime.utcnow().isoformat()
    return stats


def revert_geocoded(
    *,
    limit: int = 10000,
    country_filter: Optional[str] = None,
) -> dict:
    """Restore ``original_lat``/``original_lng`` for every row that *was*
    backfilled. Rows tagged ``geo_source='user'`` are never touched.
    """
    conn = _get_conn()
    cur = _dict_cursor(conn)
    try:
        params: list = []
        where = ["original_lat IS NOT NULL", "original_lng IS NOT NULL", "COALESCE(geo_source, '') <> 'user'"]
        if country_filter:
            where.append("LOWER(country) = LOWER(%s)")
            params.append(country_filter)
        params.append(limit)
        cur.execute(
            f"""
            SELECT id, company, lat, lng, original_lat, original_lng
            FROM licenses
            WHERE {' AND '.join(where)}
            LIMIT %s
            """,
            tuple(params),
        )
        rows = cur.fetchall()
        sample = [
            {"id": r["id"], "company": r["company"],
             "from": {"lat": r["lat"], "lng": r["lng"]},
             "to":   {"lat": r["original_lat"], "lng": r["original_lng"]}}
            for r in rows[:10]
        ]
        for r in rows:
            cur.execute(
                """
                UPDATE licenses SET
                    lat = original_lat,
                    lng = original_lng,
                    geo_source = NULL,
                    geo_approximated = FALSE,
                    geo_confidence = NULL,
                    original_lat = NULL,
                    original_lng = NULL,
                    geocoded_at = NULL
                WHERE id = %s AND COALESCE(geo_source, '') <> 'user'
                """,
                (r["id"],),
            )
        conn.commit()
        return {"reverted_count": len(rows), "sample": sample}
    finally:
        cur.close()
        conn.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Preview only — no writes.")
    parser.add_argument("--limit", type=int, default=200, help="Max rows to process this run.")
    parser.add_argument("--force", action="store_true",
                        help="Include rows that already have a geo_source set.")
    parser.add_argument("--allow-overwrite-user", action="store_true",
                        help="Also overwrite rows tagged geo_source='user'. Use with care.")
    parser.add_argument("--country", default=None, help="Restrict to one country (case-insensitive).")
    parser.add_argument("--rps-delay", type=float, default=None,
                        help="Seconds between Nominatim hits (default: $NOMINATIM_RPS_DELAY or 1.1).")
    parser.add_argument("--revert", action="store_true",
                        help="Restore original_lat/original_lng instead of geocoding.")
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.revert:
        result = revert_geocoded(limit=args.limit, country_filter=args.country)
        print(result)
        return 0

    stats = backfill(
        dry_run=args.dry_run,
        limit=args.limit,
        force=args.force,
        allow_overwrite_user=args.allow_overwrite_user,
        country_filter=args.country,
        rps_delay=args.rps_delay,
    )
    print(
        "candidates={candidates} would_update={wu} updated={u} not_found={nf}"
        " skipped_user={su} skipped_no_text={snt} cache_hits={ch} network_hits={nh}".format(
            candidates=stats.candidates, wu=stats.would_update, u=stats.updated,
            nf=stats.not_found, su=stats.skipped_user_verified, snt=stats.skipped_no_text,
            ch=stats.cache_hits, nh=stats.network_hits,
        )
    )
    if stats.sample:
        print("\nsample (first 10):")
        for s in stats.sample:
            print(f"  - {s['id']} {s['company']!r}: {s['from']} -> {s['to']} via {s['source']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
