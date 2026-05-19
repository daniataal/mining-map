"""Free public EU / EEA company register search URLs (manual verification only).

No paid registry APIs — deep links for human-in-the-loop checks next to GLEIF LEI.
"""

from __future__ import annotations

from urllib.parse import quote

# Country display name (lower) → register metadata
_EU_MS_REGISTERS: dict[str, dict[str, str]] = {
    "austria": {
        "label": "Firmenbuch (Austria)",
        "url_template": "https://www.edikte.justiz.gv.at/edikte/id/extern/landingpage.aspx?search={q}",
    },
    "belgium": {
        "label": "Belgian Crossroads Bank (CBE)",
        "url_template": "https://kbopub.economie.fgov.be/kbopub/zoeknummerform.html?nummer={q}",
    },
    "bulgaria": {
        "label": "Commercial Register (Bulgaria)",
        "url_template": "https://portal.registryagency.bg/CR/en/Reports/ActiveConditionTabResult?searchText={q}",
    },
    "croatia": {
        "label": "Sudski registar (Croatia)",
        "url_template": "https://sudreg.pravosudje.hr/registar/f?p=100:1",
    },
    "cyprus": {
        "label": "Department of Registrar of Companies (Cyprus)",
        "url_template": "https://efiling.drcor.mcit.gov.cy/DrcorPublic/SearchForm.aspx",
    },
    "czech republic": {
        "label": "Justice.cz (Czechia)",
        "url_template": "https://or.justice.cz/ias/ui/rejstrik-$firma?nazev={q}",
    },
    "czechia": {
        "label": "Justice.cz (Czechia)",
        "url_template": "https://or.justice.cz/ias/ui/rejstrik-$firma?nazev={q}",
    },
    "denmark": {
        "label": "CVR (Denmark)",
        "url_template": "https://datacvr.virk.dk/data/?search={q}",
    },
    "estonia": {
        "label": "e-Business Register (Estonia)",
        "url_template": "https://ariregister.rik.ee/eng/company/{q}",
    },
    "finland": {
        "label": "PRH / Virre (Finland)",
        "url_template": "https://www.prh.fi/fi/kaupparekisteri/hae.html?toiminto=hae&nimi={q}",
    },
    "france": {
        "label": "INPI — Registre national des entreprises",
        "url_template": "https://data.inpi.fr/recherche?q={q}",
    },
    "germany": {
        "label": "Unternehmensregister (Germany)",
        "url_template": "https://www.unternehmensregister.de/ureg/search_result.html?query={q}",
    },
    "greece": {
        "label": "GEMI (Greece)",
        "url_template": "https://www.businessregistry.gr/publicity/search",
    },
    "hungary": {
        "label": "Company Information Service (Hungary)",
        "url_template": "https://www.e-cegjegyzek.hu/?cegnev={q}",
    },
    "ireland": {
        "label": "CRO — Companies Registration Office",
        "url_template": "https://core.cro.ie/search?q={q}",
    },
    "italy": {
        "label": "Registro Imprese (Italy)",
        "url_template": "https://www.registroimprese.it/ricerca-libera?denominazione={q}",
    },
    "latvia": {
        "label": "Enterprise Register (Latvia)",
        "url_template": "https://www.ur.gov.lv/en/search?q={q}",
    },
    "lithuania": {
        "label": "JAR (Lithuania)",
        "url_template": "https://www.registrucentras.lt/jar/p_en/search.php?search={q}",
    },
    "luxembourg": {
        "label": "RCS Luxembourg",
        "url_template": "https://www.lbr.lu/mjrcs/jsp/DisplayConsultDetailActionNotSecured.action?FROM_MENU=true",
    },
    "malta": {
        "label": "Malta Business Registry",
        "url_template": "https://registry.mbr.mt/ROC/index.jsp#companySearch.do",
    },
    "netherlands": {
        "label": "KVK (Netherlands)",
        "url_template": "https://www.kvk.nl/zoeken/?q={q}",
    },
    "norway": {
        "label": "Brønnøysundregistrene (Norway)",
        "url_template": "https://www.brreg.no/bedrift/sok/?q={q}",
    },
    "poland": {
        "label": "KRS (Poland)",
        "url_template": "https://wyszukiwarka-krs.pl/?q={q}",
    },
    "portugal": {
        "label": "Racius / ePortugal",
        "url_template": "https://www.racius.com/pesquisa?q={q}",
    },
    "romania": {
        "label": "ONRC (Romania)",
        "url_template": "https://www.onrc.ro/index.php/en/",
    },
    "slovakia": {
        "label": "ORSR (Slovakia)",
        "url_template": "https://www.orsr.sk/hladaj_subjekt.asp?OBMENO={q}",
    },
    "slovenia": {
        "label": "AJPES (Slovenia)",
        "url_template": "https://www.ajpes.si/prs/podjetja.asp?pres=search&naziv={q}",
    },
    "spain": {
        "label": "Registro Mercantil (Spain)",
        "url_template": "https://www.registradores.org/registroonline/resultados_busqueda.asp?denominacion={q}",
    },
    "sweden": {
        "label": "Bolagsverket (Sweden)",
        "url_template": "https://foretagsinfo.bolagsverket.se/sok-foretagsinformation?search={q}",
    },
    "united kingdom": {
        "label": "Companies House (UK)",
        "url_template": "https://find-and-update.company-information.service.gov.uk/search/companies?q={q}",
    },
    "uk": {
        "label": "Companies House (UK)",
        "url_template": "https://find-and-update.company-information.service.gov.uk/search/companies?q={q}",
    },
}


def resolve_country_key(country: str) -> str | None:
    key = (country or "").strip().lower()
    if not key:
        return None
    if key in _EU_MS_REGISTERS:
        return key
    for candidate in _EU_MS_REGISTERS:
        if candidate in key or key in candidate:
            return candidate
    return None


def build_eu_register_link(company: str, country: str) -> dict[str, str] | None:
    """Return a single national register deep link when country matches a known MS."""
    country_key = resolve_country_key(country)
    if not country_key:
        return None
    meta = _EU_MS_REGISTERS[country_key]
    q = quote((company or "").strip())
    url = meta["url_template"].format(q=q)
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
    seen: set[str] = set()
    out: list[str] = []
    for key in sorted(_EU_MS_REGISTERS):
        if key in ("uk", "czechia"):
            continue
        label = key.replace("_", " ").title()
        if label not in seen:
            seen.add(label)
            out.append(label)
    return out
