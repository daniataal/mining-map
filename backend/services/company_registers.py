"""Free public company register search URLs (EU/EEA + Africa/LatAm/Oceania).

Manual verification only — no paid registry APIs.
"""

from __future__ import annotations

from urllib.parse import quote

# Re-use EU/EEA mapping from legacy module
try:
    from backend.services.eu_company_registers import (
        _EU_MS_REGISTERS,
        build_eu_register_link,
        list_supported_countries as list_eu_supported_countries,
        resolve_country_key as resolve_eu_country_key,
    )
except ImportError:
    from services.eu_company_registers import (  # type: ignore[no-redef]
        _EU_MS_REGISTERS,
        build_eu_register_link,
        list_supported_countries as list_eu_supported_countries,
        resolve_country_key as resolve_eu_country_key,
    )

_GLOBAL_REGISTERS: dict[str, dict[str, str]] = {
    "ghana": {
        "label": "Registrar General (Ghana)",
        "url_template": "https://egovonline.gegov.gov.gh/RGDPortalWeb/portal/RGDHome/eghana.portal?_nfpb=true&_pageLabel=rgd_portal_page_5",
    },
    "south africa": {
        "label": "CIPC (South Africa)",
        "url_template": "https://www.cipc.co.za/?page_id=1649",
    },
    "colombia": {
        "label": "RUES (Colombia)",
        "url_template": "https://www.rues.org.co/",
    },
    "peru": {
        "label": "SUNARP (Peru)",
        "url_template": "https://www.sunarp.gob.pe/seccion/servicios/detalles/0/cualquier-persona-puede-consultar-los-asientos-inscritos-en-el-registro-de-personas-juridicas/698",
    },
    "brazil": {
        "label": "RedeCNPJ (Brazil)",
        "url_template": "https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/cadastros/consultas/dados-publicos-cnpj",
    },
    "chile": {
        "label": "Registro de Empresas (Chile)",
        "url_template": "https://www.registrodeempresasysociedades.cl/Busqueda.aspx",
    },
    "mexico": {
        "label": "RPC (Mexico)",
        "url_template": "https://rpc.economia.gob.mx/",
    },
    "australia": {
        "label": "ASIC Connect (Australia)",
        "url_template": "https://connectonline.asic.gov.au/RegistrySearch/faces/landing/SearchRegisters.jspx?_adf.ctrl-state=1b6a0h6d2_4",
    },
    "canada": {
        "label": "Corporations Canada",
        "url_template": "https://ised-isde.canada.ca/cbr-rec/en/search",
    },
}


def resolve_country_key(country: str) -> str | None:
    """Resolve display country to a register key (EU first, then global)."""
    eu_key = resolve_eu_country_key(country)
    if eu_key:
        return eu_key
    key = (country or "").strip().lower()
    if not key:
        return None
    if key in _GLOBAL_REGISTERS:
        return key
    for candidate in _GLOBAL_REGISTERS:
        if candidate in key or key in candidate:
            return candidate
    return None


def build_register_link(company: str, country: str) -> dict[str, str] | None:
    """National register deep link when country is known (EU or global free portal)."""
    eu_link = build_eu_register_link(company, country)
    if eu_link:
        return eu_link
    country_key = resolve_country_key(country)
    if not country_key or country_key in _EU_MS_REGISTERS:
        return None
    meta = _GLOBAL_REGISTERS.get(country_key)
    if not meta:
        return None
    q = quote((company or "").strip())
    url = meta["url_template"].format(q=q) if "{q}" in meta["url_template"] else meta["url_template"]
    return {
        "label": meta["label"],
        "url": url,
        "country": country.strip(),
        "country_key": country_key,
        "description": f"Search '{company}' in the national company register ({country})",
        "manual_only": True,
        "api_backed": False,
    }


def list_supported_countries() -> list[str]:
    seen: set[str] = set(list_eu_supported_countries())
    for key in sorted(_GLOBAL_REGISTERS):
        label = key.replace("_", " ").title()
        if label not in seen:
            seen.add(label)
    return sorted(seen)
