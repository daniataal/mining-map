"""Optional web-backed public contact discovery for the contact enrichment agent.

Uses configured search APIs (Google Programmable Search or SerpAPI) to locate a
company website, then extracts mailto:/tel: and validated email/phone patterns
from fetched HTML. Does not fabricate values: every candidate ties to a URL we
actually retrieved.

Respects robots.txt with a small parser (User-agent: * Disallow rules only).
"""

from __future__ import annotations

import json
import logging
import re
from html import unescape
from typing import Any, Optional
from urllib.parse import urlparse, urljoin, urlunparse

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None  # type: ignore[assignment]

try:
    from backend.services.entity_contacts import (
        CONTACT_TYPE_ORDER,
        _fingerprint,
        _is_valid_contact_value,
        _normalized_contact_value,
    )
except ImportError:
    from services.entity_contacts import (  # type: ignore[no-redef]
        CONTACT_TYPE_ORDER,
        _fingerprint,
        _is_valid_contact_value,
        _normalized_contact_value,
    )

logger = logging.getLogger(__name__)

DEFAULT_UA = "MeridianMiningMap/1.0 (open-data research; contact discovery)"

# Suffixes stripped before building a search query (generic, not jurisdiction-specific).
_COMPANY_SUFFIX_RE = re.compile(
    r"(?i)[,\s]+(ltd\.?|limited|plc|llc|gmbh|inc\.?|corp\.?|corporation|company|co\.?)\s*$"
)

# mailto: and tel: in href/src (case-insensitive).
_MAILTO_HREF_RE = re.compile(
    r"""href\s*=\s*["']mailto:([^"'>\s]+)["']""",
    re.IGNORECASE,
)
_TEL_HREF_RE = re.compile(
    r"""href\s*=\s*["']tel:([^"'>\s]+)["']""",
    re.IGNORECASE,
)

# Conservative email scan in visible anchors / text (after mailto pass).
_EMAIL_IN_TEXT_RE = re.compile(
    r"\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b",
)

_BLOCKED_SEARCH_HOST_FRAGMENTS = (
    "facebook.com",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "tiktok.com",
    "youtube.com",
    "google.com/maps",
    "wikipedia.org",
    "opencorporates.com",
    "bloomberg.com",
    "reuters.com",
)


def normalize_company_name_for_search(name: str) -> str:
    """Normalize a legal/CSV company name for search queries.

    - Collapses whitespace
    - Normalizes ampersand spacing (``M & C`` / ``M&C`` → ``M & C``)
    - Strips common corporate suffixes (Ltd, Limited, LLC, …)
    - Removes stray punctuation except ``&``
    """
    raw = " ".join(str(name or "").split())
    if not raw:
        return ""
    s = re.sub(r"\s*&\s*", " & ", raw)
    s = _COMPANY_SUFFIX_RE.sub("", s).strip()
    s = re.sub(r"[^\w\s&]", " ", s)
    s = " ".join(s.split())
    return s


def _http_get(url: str, *, timeout: float = 8.0, max_bytes: int = 524_288) -> tuple[int, str, str]:
    """Return (status, content_type, text). Truncates body to max_bytes. No response body in logs."""
    if requests is None:
        return 0, "", ""
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": DEFAULT_UA, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"},
            timeout=timeout,
        )
    except (OSError, Exception) as exc:
        logger.info("contact_web_discovery fetch failed host=%s err=%s", urlparse(url).netloc, type(exc).__name__)
        return 0, "", ""
    ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    text = resp.text[:max_bytes] if resp.text else ""
    return resp.status_code, ctype, text


def _same_registrable_domain(a: str, b: str) -> bool:
    """Loose same-site check: registrable part of host (last two labels)."""
    try:
        ha, hb = urlparse(a).netloc.lower(), urlparse(b).netloc.lower()
    except Exception:
        return False
    if not ha or not hb:
        return False

    def _registrable(host: str) -> str:
        parts = host.split(".")
        if len(parts) >= 2:
            return ".".join(parts[-2:])
        return host

    return _registrable(ha) == _registrable(hb)


def _blocked_result_link(url: str) -> bool:
    u = (url or "").lower()
    return any(fragment in u for fragment in _BLOCKED_SEARCH_HOST_FRAGMENTS)


def _parse_robots_disallow_prefixes(robots_txt: str) -> list[str]:
    """Collect Disallow paths for the first User-agent: * block."""
    prefixes: list[str] = []
    in_star = False
    for raw_line in robots_txt.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        low = line.lower()
        if low.startswith("user-agent:"):
            ua = line.split(":", 1)[1].strip()
            in_star = ua == "*"
            continue
        if in_star and low.startswith("disallow:"):
            path = line.split(":", 1)[1].strip()
            if path:
                prefixes.append(path)
    return prefixes


def _robots_disallows_fetch(url: str) -> bool:
    """True if robots.txt says we must not fetch this URL (User-agent: *)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return True
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    status, ctype, body = _http_get(robots_url, timeout=5.0, max_bytes=65_536)
    if status == 404:
        return False
    if status != 200 or "text" not in ctype:
        return False
    path = parsed.path or "/"
    if not path.startswith("/"):
        path = "/" + path
    for prefix in _parse_robots_disallow_prefixes(body):
        if prefix == "/":
            return True
        if path.startswith(prefix):
            return True
    return False


def _google_cse_search_urls(query: str, *, api_key: str, cx: str, num: int = 6) -> list[str]:
    if not requests:
        return []
    params = {"key": api_key, "cx": cx, "q": query, "num": str(min(num, 10))}
    url = "https://www.googleapis.com/customsearch/v1"
    try:
        resp = requests.get(
            url,
            params=params,
            headers={"User-Agent": DEFAULT_UA},
            timeout=10.0,
        )
    except (OSError, Exception) as exc:
        logger.info("Google CSE request failed: %s", type(exc).__name__)
        return []
    if resp.status_code != 200:
        logger.info("Google CSE HTTP %s", resp.status_code)
        return []
    try:
        data = resp.json()
    except (ValueError, json.JSONDecodeError):
        return []
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        link = str(item.get("link") or "").strip()
        if link.startswith("http") and not _blocked_result_link(link):
            out.append(link)
    return out


def _serpapi_search_urls(query: str, *, api_key: str, num: int = 6) -> list[str]:
    if not requests:
        return []
    params = {"engine": "google", "q": query, "api_key": api_key, "num": str(min(num, 10))}
    try:
        resp = requests.get(
            "https://serpapi.com/search.json",
            params=params,
            headers={"User-Agent": DEFAULT_UA},
            timeout=12.0,
        )
    except (OSError, Exception) as exc:
        logger.info("SerpAPI request failed: %s", type(exc).__name__)
        return []
    if resp.status_code != 200:
        logger.info("SerpAPI HTTP %s", resp.status_code)
        return []
    try:
        data = resp.json()
    except (ValueError, json.JSONDecodeError):
        return []
    organic = data.get("organic_results") if isinstance(data, dict) else None
    if not isinstance(organic, list):
        return []
    out: list[str] = []
    for row in organic:
        if not isinstance(row, dict):
            continue
        link = str(row.get("link") or "").strip()
        if link.startswith("http") and not _blocked_result_link(link):
            out.append(link)
    return out


def discover_search_result_urls(
    query: str,
    *,
    google_cse_key: str = "",
    google_cse_cx: str = "",
    serpapi_key: str = "",
) -> tuple[list[str], str]:
    """Return (urls, engine_label). Prefer Google CSE when both configured."""
    q = query.strip()
    if not q:
        return [], "none"
    if google_cse_key and google_cse_cx:
        urls = _google_cse_search_urls(q, api_key=google_cse_key, cx=google_cse_cx)
        return urls, "google_cse"
    if serpapi_key:
        urls = _serpapi_search_urls(q, api_key=serpapi_key)
        return urls, "serpapi"
    return [], "none"


def _response_looks_like_html(status: int, ctype: str, body: str) -> bool:
    if status != 200 or not body:
        return False
    c = (ctype or "").lower()
    if "html" in c or "xml" in c:
        return True
    head = body[:4000].lower()
    return "<html" in head or "<!doctype html" in head


def unquote_safe(value: str) -> str:
    try:
        from urllib.parse import unquote

        return unquote(value)
    except Exception:
        return value


def _extract_contact_hrefs(html: str, base_url: str) -> tuple[set[str], set[str], set[str]]:
    """From HTML, return sets of (emails, phones, same-site http URLs for /contact)."""
    emails: set[str] = set()
    phones: set[str] = set()
    extra_pages: set[str] = set()
    html = unescape(html or "")

    for match in _MAILTO_HREF_RE.finditer(html):
        raw = unescape(match.group(1).split("?", 1)[0].strip())
        addr = unquote_safe(raw)
        if addr and _is_valid_contact_value("email", addr):
            emails.add(addr)

    for match in _TEL_HREF_RE.finditer(html):
        raw = unescape(match.group(1).strip())
        phone = re.sub(r"[\s\-]+", " ", raw).strip()
        if phone and _is_valid_contact_value("phone", phone):
            phones.add(phone)

    # Same-site contact/about links (relative or absolute).
    for m in re.finditer(r"""href\s*=\s*["']([^"']+)["']""", html, re.IGNORECASE):
        href = unescape(m.group(1).strip())
        if not href or href.startswith("#") or href.lower().startswith("javascript:"):
            continue
        joined = urljoin(base_url, href)
        if not joined.lower().startswith("http"):
            continue
        if not _same_registrable_domain(joined, base_url):
            continue
        path = urlparse(joined).path.lower()
        if any(seg in path for seg in ("/contact", "contact-us", "contact_us", "/about", "/reach")):
            extra_pages.add(urlunparse(urlparse(joined)._replace(fragment="", query="")))

    # Fallback emails in page (mailto already captured most).
    if len(emails) < 3:
        for em in _EMAIL_IN_TEXT_RE.findall(html):
            cleaned = em.strip().strip(".,);]")
            if _is_valid_contact_value("email", cleaned):
                emails.add(cleaned)

    # Ghana + international +233 etc. in visible tel text (not href).
    if len(phones) < 2:
        for m in re.finditer(r"\+?\d[\d\s().\-/]{8,22}\d", html):
            chunk = re.sub(r"\s+", " ", m.group(0)).strip()
            if _is_valid_contact_value("phone", chunk):
                phones.add(chunk)

    return emails, phones, extra_pages


def extract_public_contacts_from_html(
    html: str,
    page_url: str,
) -> tuple[set[str], set[str], set[str]]:
    """Parse HTML for public emails, phones, and related on-site URLs."""
    return _extract_contact_hrefs(html, page_url)


def _candidate(
    *,
    entity_id: str,
    contact_type: str,
    value: str,
    source_name: str,
    source_url: str,
    extracted_from: str,
    evidence: dict[str, Any],
) -> Optional[dict[str, Any]]:
    if not _is_valid_contact_value(contact_type, value):
        return None
    normalized_value = _normalized_contact_value(contact_type, value)
    fp = _fingerprint("license", entity_id, contact_type, normalized_value, source_name, source_url)
    return {
        "id": fp,
        "fingerprint": fp,
        "entity_kind": "license",
        "entity_id": entity_id,
        "contact_type": contact_type,
        "contact_scope": "public_business",
        "label": extracted_from,
        "value": value,
        "normalized_value": normalized_value,
        "source_name": source_name,
        "source_url": source_url,
        "source_type": "web_fetched",
        "confidence_score": 0.64,
        "raw_payload": evidence,
        "extracted_from": extracted_from,
        "verified_at": None,
        "discovered_by": "web",
    }


def discover_web_contact_candidates(
    *,
    entity_id: str,
    company: str,
    country: str = "",
    google_cse_key: str = "",
    google_cse_cx: str = "",
    serpapi_key: str = "",
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Search + fetch + extract. Returns (candidates, diagnostics dict)."""
    diag: dict[str, Any] = {"engine": "none", "query": None, "urls_tried": [], "skipped_robots": []}
    norm = normalize_company_name_for_search(company)
    if len(norm) < 3:
        return [], diag

    country_bit = str(country or "").strip()
    query = f'"{norm}" official website'
    if country_bit:
        query = f"{query} {country_bit}"
    diag["query"] = query

    urls, engine = discover_search_result_urls(
        query,
        google_cse_key=google_cse_key,
        google_cse_cx=google_cse_cx,
        serpapi_key=serpapi_key,
    )
    diag["engine"] = engine
    if not urls:
        return [], diag

    seen_pages: set[str] = set()
    candidates: dict[str, dict[str, Any]] = {}
    source_label = "Web discovery (search + fetched page)"

    for seed in urls[:2]:
        if _robots_disallows_fetch(seed):
            diag["skipped_robots"].append(seed)
            continue
        status, ctype, html = _http_get(seed, timeout=8.0)
        diag["urls_tried"].append({"url": seed, "status": status})
        if not _response_looks_like_html(status, ctype, html):
            continue
        if seed in seen_pages:
            continue
        seen_pages.add(seed)

        emails, phones, extra = _extract_contact_hrefs(html, seed)
        for em in emails:
            c = _candidate(
                entity_id=entity_id,
                contact_type="email",
                value=em,
                source_name=source_label,
                source_url=seed,
                extracted_from="mailto_or_page_text",
                evidence={"kind": "email", "page_url": seed},
            )
            if c:
                candidates[c["fingerprint"]] = c
        for ph in phones:
            c = _candidate(
                entity_id=entity_id,
                contact_type="phone",
                value=ph,
                source_name=source_label,
                source_url=seed,
                extracted_from="tel_or_page_text",
                evidence={"kind": "phone", "page_url": seed},
            )
            if c:
                candidates[c["fingerprint"]] = c

        # Official website row (the page we successfully read).
        try:
            pu = urlparse(seed)
            site = f"{pu.scheme}://{pu.netloc}".rstrip("/")
            if _is_valid_contact_value("website", site):
                c = _candidate(
                    entity_id=entity_id,
                    contact_type="website",
                    value=site,
                    source_name=source_label,
                    source_url=seed,
                    extracted_from="search_result_landing",
                    evidence={"kind": "website", "page_url": seed},
                )
                if c:
                    candidates[c["fingerprint"]] = c
        except Exception:
            pass

        # One extra same-site contact-ish page.
        for extra_url in list(extra)[:1]:
            if extra_url in seen_pages:
                continue
            if _robots_disallows_fetch(extra_url):
                diag["skipped_robots"].append(extra_url)
                continue
            st2, ct2, html2 = _http_get(extra_url, timeout=8.0)
            diag["urls_tried"].append({"url": extra_url, "status": st2})
            if not _response_looks_like_html(st2, ct2, html2):
                continue
            seen_pages.add(extra_url)
            em2, ph2, _ = _extract_contact_hrefs(html2, extra_url)
            for em in em2:
                c = _candidate(
                    entity_id=entity_id,
                    contact_type="email",
                    value=em,
                    source_name=source_label,
                    source_url=extra_url,
                    extracted_from="contact_page",
                    evidence={"kind": "email", "page_url": extra_url},
                )
                if c:
                    candidates[c["fingerprint"]] = c
            for ph in ph2:
                c = _candidate(
                    entity_id=entity_id,
                    contact_type="phone",
                    value=ph,
                    source_name=source_label,
                    source_url=extra_url,
                    extracted_from="contact_page",
                    evidence={"kind": "phone", "page_url": extra_url},
                )
                if c:
                    candidates[c["fingerprint"]] = c

        if len(candidates) >= 6:
            break

    merged = sorted(
        candidates.values(),
        key=lambda item: (CONTACT_TYPE_ORDER.get(item["contact_type"], 99), -(item["confidence_score"] or 0.0)),
    )
    return merged, diag
