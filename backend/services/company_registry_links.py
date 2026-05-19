"""Manual company verification links (OpenCorporates + EU national registers)."""

from __future__ import annotations

from urllib.parse import quote

try:
    from backend.services.company_registers import build_register_link
except ImportError:
    from services.company_registers import build_register_link  # type: ignore[no-redef]


OPENCORPORATES_DISCLAIMER = (
    "Manual verification via OpenCorporates web search — not API-backed. "
    "OpenCorporates API is paid; Meridian does not call it."
)


def build_opencorporates_link(company: str) -> dict[str, object]:
    q = quote((company or "").strip())
    return {
        "label": "OpenCorporates Search",
        "url": f"https://opencorporates.com/companies?q={q}",
        "description": f"Search '{company}' across 200+ company registries (web UI)",
        "icon": "building",
        "manual_only": True,
        "api_backed": False,
        "disclaimer": OPENCORPORATES_DISCLAIMER,
    }


def collect_registry_links(company: str, country: str = "") -> dict[str, object]:
    """Aggregate free manual registry links for dossier / company-intel."""
    company = (company or "").strip()
    country = (country or "").strip()
    links: list[dict[str, object]] = []
    if company:
        links.append(build_opencorporates_link(company))
    national = build_register_link(company, country) if company and country else None
    if national:
        links.append(national)
    return {
        "company": company,
        "country": country,
        "links": links,
        "opencorporates_disclaimer": OPENCORPORATES_DISCLAIMER,
        "limitations": [
            "All registry links require manual human verification in the browser.",
            "No paid OpenCorporates or national registry APIs are used.",
        ],
    }
