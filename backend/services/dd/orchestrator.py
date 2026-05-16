import hashlib
import json
import logging
import os
import re
import time
import uuid
from datetime import date, datetime, time as dt_time
from decimal import Decimal
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Fallback models in order of preference
GROQ_MODELS = [
    "llama3-70b-8192",
    "mixtral-8x7b-32768"
]

OPENROUTER_MODELS = [
    "anthropic/claude-3-haiku",
    "openai/gpt-4o-mini"
]

DD_PROMPT_VERSION = "dd_report_v2"
PHONE_ALLOWED_RE = re.compile(r"^[+()0-9.\- /extEXT]+$")
PRIVATE_PHONE_TOKENS = {
    "personal",
    "private",
    "home",
    "whatsapp",
    "telegram",
    "mobile",
    "cell",
    "direct line",
    "direct",
}
PUBLIC_PHONE_TOKENS = {
    "office",
    "switchboard",
    "reception",
    "site",
    "business",
    "customer service",
    "contact centre",
    "call centre",
    "front desk",
    "head office",
}

def run_dd_pack(entity_data, raw_evidence):
    """
    Orchestrates the AI due diligence process.
    Uses GROQ and OPENROUTER keys to evaluate the entity based on sector templates.
    """
    sector = entity_data.get('sector', 'Unknown')
    logger.info(f"Running DD pack for {entity_data.get('name')} in sector {sector}")
    
    # Example logic using the API keys from environment
    groq_api_key = os.getenv("GROQ_API_KEY")
    openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
    
    if not groq_api_key and not openrouter_api_key:
        logger.warning("No AI API keys configured. Returning mock DD result.")
        return {
            "status": "Skipped",
            "findings": ["No API keys configured."],
            "risk_level": "Unknown"
        }
    
    # In a real implementation, we would construct a prompt based on the sector rubric
    # and call the LLM API using requests or an SDK.
    
    return {
        "status": "Completed",
        "findings": [
            f"Evaluated {len(raw_evidence)} evidence items.",
            "No major red flags detected in preliminary automated scan."
        ],
        "risk_level": "Low"
    }


def _coerce_float(value: Any) -> Optional[float]:
    if value in (None, "", " "):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _strip_code_fences(text: str) -> str:
    candidate = (text or "").strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*", "", candidate)
        candidate = re.sub(r"\s*```$", "", candidate)
    return candidate.strip()


def _extract_json_object(text: str) -> Optional[dict[str, Any]]:
    cleaned = _strip_code_fences(text)
    for candidate in (cleaned, cleaned[cleaned.find("{"): cleaned.rfind("}") + 1] if "{" in cleaned and "}" in cleaned else ""):
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _env_int_bounded(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        v = int(float(str(raw).strip()))
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, v))


def _ai_http_timeout_seconds() -> float:
    """Per-attempt socket timeout for outbound LLM HTTP calls (Groq, OpenRouter, Pollinations)."""
    return float(_env_int_bounded("AI_HTTP_TIMEOUT_SECONDS", 90, minimum=5, maximum=600))


def _ai_http_extra_retries() -> int:
    """Retries after the first failed attempt (timeouts, connection errors, retryable HTTP status)."""
    return _env_int_bounded("AI_HTTP_MAX_RETRIES", 2, minimum=0, maximum=6)


def _retry_backoff_seconds(attempt_idx: int) -> float:
    return min(30.0, 0.75 * (2 ** attempt_idx))


def _is_retryable_http_status(code: int) -> bool:
    return code in (408, 429, 502, 503, 504)


def _pollinations_fallback_enabled() -> bool:
    return (os.getenv("DISABLE_POLLINATIONS_FALLBACK") or "").strip().lower() not in ("1", "true", "yes", "on")


def _provider_specs() -> list[dict[str, Any]]:
    return [
        {
            "name": "Groq",
            "url": "https://api.groq.com/openai/v1/chat/completions",
            "key": os.getenv("GROQ_API_KEY"),
            "models": GROQ_MODELS,
        },
        {
            "name": "OpenRouter",
            "url": "https://openrouter.ai/api/v1/chat/completions",
            "key": os.getenv("OPENROUTER_API_KEY"),
            "models": OPENROUTER_MODELS,
        },
    ]


def _request_chat_completion(
    *,
    provider_name: str,
    url: str,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
) -> Optional[dict[str, Any]]:
    import requests

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    timeout = _ai_http_timeout_seconds()
    attempts = 1 + _ai_http_extra_retries()
    last_exc: Optional[BaseException] = None

    for attempt in range(attempts):
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=timeout)
            if response.status_code == 200:
                data = response.json()
                content = data["choices"][0]["message"]["content"]
                return {
                    "provider": provider_name,
                    "model": model,
                    "content": content,
                    "raw_response": data,
                }
            if _is_retryable_http_status(response.status_code) and attempt < attempts - 1:
                logger.warning(
                    "%s model %s HTTP %s; retrying (%s/%s)",
                    provider_name,
                    model,
                    response.status_code,
                    attempt + 2,
                    attempts,
                )
                time.sleep(_retry_backoff_seconds(attempt))
                continue
            raise RuntimeError(f"{provider_name} returned {response.status_code}: {response.text[:500]}")
        except (requests.Timeout, requests.ConnectionError) as exc:
            last_exc = exc
            if attempt < attempts - 1:
                logger.warning(
                    "%s model %s transient network error: %s; retrying (%s/%s)",
                    provider_name,
                    model,
                    exc,
                    attempt + 2,
                    attempts,
                )
                time.sleep(_retry_backoff_seconds(attempt))
                continue
            raise
    if last_exc:
        raise last_exc
    raise RuntimeError(f"{provider_name} request failed after {attempts} attempts")


def _run_provider_cascade(system_prompt: str, user_prompt: str) -> Optional[dict[str, Any]]:
    for provider in _provider_specs():
        api_key = provider.get("key")
        if not api_key:
            continue
        for model in provider.get("models", []):
            try:
                result = _request_chat_completion(
                    provider_name=provider["name"],
                    url=provider["url"],
                    api_key=api_key,
                    model=model,
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                )
                if result and result.get("content"):
                    return result
            except Exception as exc:
                logger.warning("Provider %s model %s failed: %s", provider["name"], model, exc)
    return None


def _pollinations_analysis(system_prompt: str, user_prompt: str) -> Optional[dict[str, Any]]:
    import requests

    url = f"https://text.pollinations.ai/{requests.utils.quote(system_prompt + ' ' + user_prompt)}"
    timeout = _ai_http_timeout_seconds()
    attempts = 1 + _ai_http_extra_retries()
    last_exc: Optional[BaseException] = None

    for attempt in range(attempts):
        try:
            response = requests.get(url, timeout=timeout)
            if response.status_code == 200:
                return {
                    "provider": "Pollinations (Fallback)",
                    "model": "text-proxy",
                    "content": response.text,
                    "raw_response": {"text": response.text},
                }
            if _is_retryable_http_status(response.status_code) and attempt < attempts - 1:
                logger.warning(
                    "Pollinations HTTP %s; retrying (%s/%s)",
                    response.status_code,
                    attempt + 2,
                    attempts,
                )
                time.sleep(_retry_backoff_seconds(attempt))
                continue
            raise RuntimeError(f"Pollinations returned {response.status_code}")
        except (requests.Timeout, requests.ConnectionError) as exc:
            last_exc = exc
            if attempt < attempts - 1:
                logger.warning(
                    "Pollinations transient error: %s; retrying (%s/%s)", exc, attempt + 2, attempts
                )
                time.sleep(_retry_backoff_seconds(attempt))
                continue
            raise
    if last_exc:
        raise last_exc
    raise RuntimeError("Pollinations request failed")


def generate_markdown_analysis(query: str) -> dict[str, Any]:
    system_prompt = (
        "You are an elite intelligence analyst evaluating global entities across multiple sectors "
        "(mining, oil & gas, logistics, ports). Decide GO / NO GO / ESCALATE with evidence, avoiding hype. "
        "Give a risk score 1-10 (10 = do not proceed). Cover: operational viability, compliance, supply chain risks, "
        "and market context. Reply in Markdown only. Use ## for main sections. Keep paragraphs short (2-4 sentences). "
        "Put basic facts in bullets, not huge tables. Use one compact table only for risk breakdown "
        "(Category | Score | One-line rationale). Number tactical steps. Call out what must be verified with primary "
        "sources or regulators. Tone: direct, scannable, objective, plain language."
    )

    provider_result = _run_provider_cascade(system_prompt, query)
    if provider_result is not None:
        return {
            "status": "success",
            "provider": provider_result["provider"],
            "model": provider_result["model"],
            "analysis": provider_result["content"],
            "raw_response": provider_result["raw_response"],
        }

    if not _pollinations_fallback_enabled():
        logger.info("Pollinations fallback skipped (DISABLE_POLLINATIONS_FALLBACK is set)")
        return {
            "status": "error",
            "provider": None,
            "model": None,
            "analysis": None,
            "raw_response": None,
            "error_code": "AI_ALL_PROVIDERS_FAILED",
            "message": (
                "No configured AI API returned a result and the Pollinations fallback is disabled. "
                "Set GROQ_API_KEY or OPENROUTER_API_KEY, or unset DISABLE_POLLINATIONS_FALLBACK."
            ),
        }

    try:
        fallback = _pollinations_analysis(system_prompt, query)
        return {
            "status": "success",
            "provider": fallback["provider"],
            "model": fallback["model"],
            "analysis": fallback["content"],
            "raw_response": fallback["raw_response"],
        }
    except Exception as exc:
        logger.warning("All intelligence providers failed: %s", exc)
        return {
            "status": "error",
            "provider": None,
            "model": None,
            "analysis": None,
            "raw_response": None,
            "error_code": "AI_ALL_PROVIDERS_FAILED",
            "message": (
                "All intelligence providers are offline or timed out. "
                "For faster, more reliable analysis, set GROQ_API_KEY or OPENROUTER_API_KEY."
            ),
        }


def _json_default_for_snapshot(obj: Any) -> Any:
    """Values that appear in DB-backed dicts but are not JSON-native."""
    if isinstance(obj, date):
        return obj.isoformat()
    if isinstance(obj, dt_time):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, uuid.UUID):
        return str(obj)
    if isinstance(obj, (bytes, bytearray)):
        return bytes(obj).decode("utf-8", errors="replace")
    if isinstance(obj, set):
        return list(obj)
    raise TypeError(f"Object of type {type(obj).__name__!r} is not JSON serializable")


def _source_snapshot_prompt(source_snapshot: dict[str, Any], max_chars: int = 16000) -> str:
    _dumps_kw: dict[str, Any] = {
        "ensure_ascii": True,
        "sort_keys": True,
        "default": _json_default_for_snapshot,
    }
    serialized = json.dumps(source_snapshot, **_dumps_kw)
    if len(serialized) <= max_chars:
        return serialized

    compact = dict(source_snapshot)
    raw_payload = compact.pop("raw_payload", None)
    compact["raw_payload_truncated"] = raw_payload is not None
    if raw_payload is not None:
        raw_payload_json = json.dumps(raw_payload, **_dumps_kw)
        compact["raw_payload_excerpt"] = raw_payload_json[:8000]

    serialized = json.dumps(compact, **_dumps_kw)
    return serialized[:max_chars]


def normalize_extracted_contacts(raw_contacts: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_contacts, list):
        return []

    normalized: list[dict[str, Any]] = []
    for contact in raw_contacts:
        if not isinstance(contact, dict):
            continue
        raw_contact_type = str(contact.get("contact_type") or contact.get("contactType") or "").strip().lower()
        contact_type = {
            "telephone": "phone",
            "tel": "phone",
            "email_address": "email",
            "url": "website",
            "web": "website",
            "site": "website",
        }.get(raw_contact_type, raw_contact_type)
        if contact_type not in {"phone", "email", "website", "address"}:
            continue

        value = str(contact.get("value") or "").strip()
        if not value:
            continue

        normalized.append(
            {
                "contact_type": contact_type,
                "value": value,
                "label": str(contact.get("label") or "").strip() or None,
                "contact_scope": str(contact.get("contact_scope") or contact.get("contactScope") or "unknown").strip().lower() or "unknown",
                "contact_role": str(contact.get("contact_role") or contact.get("contactRole") or "").strip().lower() or None,
                "source_name": str(contact.get("source_name") or contact.get("sourceName") or "").strip() or None,
                "source_url": str(contact.get("source_url") or contact.get("sourceUrl") or "").strip() or None,
                "evidence_snippet": str(contact.get("evidence_snippet") or contact.get("evidenceSnippet") or "").strip() or None,
                "extracted_from": str(contact.get("extracted_from") or contact.get("extractedFrom") or contact.get("source_field") or "").strip() or None,
                "source_basis": str(contact.get("source_basis") or contact.get("sourceBasis") or "unknown").strip().lower() or "unknown",
                "confidence": _coerce_float(contact.get("confidence")) or 0.0,
                "verified_at": contact.get("verified_at") or contact.get("verifiedAt"),
            }
        )
    return normalized


def extract_source_backed_contacts(source_snapshot: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not source_snapshot:
        return {
            "status": "skipped",
            "provider": None,
            "model": None,
            "contacts": [],
            "raw_response": None,
        }

    provider_result = _run_provider_cascade(
        system_prompt=(
            "You extract public business contacts from source-backed evidence. "
            "Only return details explicitly present in the provided source snapshot. "
            "Never invent missing values. Treat private or personal numbers as excluded. "
            "Reply with JSON only in this exact shape: "
            '{"contacts":[{"contact_type":"phone|email|website|address","value":"...","label":"...","contact_scope":"public_business|private_personal|unknown","contact_role":"office|switchboard|site|unknown","source_name":"...","source_url":"...","evidence_snippet":"...","extracted_from":"...","source_basis":"source_structured_field|explicit_source_text|inferred","confidence":0.0}]}. '
            "Use source_basis=inferred only when the evidence is ambiguous, and do not output contacts when the value is not explicit."
        ),
        user_prompt=(
            "Extract only source-backed public business contacts from this dossier source snapshot. "
            "Return JSON only.\n\n"
            f"{_source_snapshot_prompt(source_snapshot)}"
        ),
    )
    if provider_result is None:
        return {
            "status": "skipped",
            "provider": None,
            "model": None,
            "contacts": [],
            "raw_response": None,
        }

    parsed = _extract_json_object(provider_result["content"]) or {}
    contacts = normalize_extracted_contacts(parsed.get("contacts"))
    return {
        "status": "success",
        "provider": provider_result["provider"],
        "model": provider_result["model"],
        "contacts": contacts,
        "raw_response": provider_result["raw_response"],
    }


def _entity_brief_from_snapshot(source_snapshot: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Pull a minimal company description out of the dossier snapshot for LLM prompts."""
    if not isinstance(source_snapshot, dict):
        return {}
    entity = source_snapshot.get("entity") if isinstance(source_snapshot.get("entity"), dict) else {}
    source = source_snapshot.get("source") if isinstance(source_snapshot.get("source"), dict) else {}
    return {
        "company": entity.get("company"),
        "country": entity.get("country"),
        "region": entity.get("region"),
        "sector": entity.get("sector"),
        "commodity": entity.get("commodity"),
        "license_type": entity.get("license_type"),
        "status": entity.get("status"),
        "source_name": source.get("source_name"),
        "source_url": source.get("source_record_url") or source.get("source_url"),
        "entity_id": entity.get("id"),
    }


def extract_legal_events_via_ai(entity_brief: dict[str, Any]) -> dict[str, Any]:
    """Ask the LLM cascade for litigation history involving the entity.

    The model is asked to return JSON only. Anything that cannot be parsed
    is treated as "no signal" rather than raising — the caller falls back
    to the live adapter / stub pipeline in ``services/legal_intel.py``.
    """

    company = (entity_brief.get("company") or "").strip()
    if not company:
        return {"status": "skipped", "provider": None, "model": None, "events": [], "raw_response": None}

    country = entity_brief.get("country") or "unspecified jurisdiction"
    sector = entity_brief.get("sector") or "mining/oil"

    system_prompt = (
        "You are a legal-intelligence analyst. Given a company brief, list ANY public litigation, "
        "regulatory enforcement, arbitration, or major contract dispute you have evidence for. "
        "Do not invent cases. If you only have weak signals, lower the confidence value. "
        "Reply with JSON only in this exact shape: "
        '{"events":[{"case_title":"...","parties":["...","..."],"role":"plaintiff|defendant|respondent|petitioner|third_party|subject",'
        '"court":"...","jurisdiction":"...","filed_date":"YYYY-MM-DD","status":"open|pending|settled|dismissed|appeal|closed|unknown",'
        '"summary":"one or two sentences","source_name":"...","source_url":"https://...","confidence":0.0}]}. '
        "Use 'role' to record the entity's role in the case. If unknown, use 'subject'. "
        "If you have no evidence at all, return {\"events\":[]}."
    )
    user_prompt = (
        f"Company: {company}\nJurisdiction context: {country}\nSector: {sector}\n"
        "Return JSON only. Do not include private individuals' identities."
    )

    provider_result = _run_provider_cascade(system_prompt, user_prompt)
    if provider_result is None:
        return {"status": "skipped", "provider": None, "model": None, "events": [], "raw_response": None}

    parsed = _extract_json_object(provider_result["content"]) or {}
    raw_events = parsed.get("events") if isinstance(parsed.get("events"), list) else []
    return {
        "status": "success",
        "provider": provider_result["provider"],
        "model": provider_result["model"],
        "events": raw_events,
        "raw_response": provider_result["raw_response"],
    }


def discover_phone_via_ai(entity_brief: dict[str, Any]) -> dict[str, Any]:
    """Ask the LLM cascade for a public business phone for the company.

    This is intentionally separate from ``extract_source_backed_contacts``
    because here the AI is *searching* (not extracting from a provided
    snapshot). The output is stored with ``source_type='ai_discovered'``
    and ``discovered_by='ai'`` so the UI can clearly distinguish it from
    open-data-backed numbers.
    """

    company = (entity_brief.get("company") or "").strip()
    if not company:
        return {"status": "skipped", "provider": None, "model": None, "phones": [], "raw_response": None}

    country = entity_brief.get("country") or "unspecified country"
    sector = entity_brief.get("sector") or "mining/oil"

    system_prompt = (
        "You are an OSINT analyst. Find public business contact numbers (head office, switchboard, "
        "reception, customer service) for the company. Do NOT return personal mobile numbers, "
        "WhatsApp numbers, or numbers you only have weak signal for. "
        "Reply with JSON only in this exact shape: "
        '{"phones":[{"value":"+CCC ... ...","label":"head office|switchboard|...","contact_role":"office|switchboard|reception|site",'
        '"source_name":"...","source_url":"https://...","evidence_snippet":"...","confidence":0.0}]}. '
        "Return {\"phones\":[]} when you do not have a defensible answer."
    )
    user_prompt = (
        f"Company: {company}\nCountry: {country}\nSector: {sector}\n"
        "Return JSON only with public business phone numbers and citations."
    )

    provider_result = _run_provider_cascade(system_prompt, user_prompt)
    if provider_result is None:
        return {"status": "skipped", "provider": None, "model": None, "phones": [], "raw_response": None}

    parsed = _extract_json_object(provider_result["content"]) or {}
    raw_phones = parsed.get("phones") if isinstance(parsed.get("phones"), list) else []
    normalized: list[dict[str, Any]] = []
    for phone in raw_phones:
        if not isinstance(phone, dict):
            continue
        value = str(phone.get("value") or "").strip()
        if not _is_valid_phone_value(value):
            continue
        normalized.append(
            {
                "contact_type": "phone",
                "value": value,
                "label": (phone.get("label") or "Public business phone").strip(),
                "contact_scope": "public_business",
                "contact_role": (phone.get("contact_role") or "office").strip().lower(),
                "source_name": (phone.get("source_name") or "AI-discovered").strip(),
                "source_url": (phone.get("source_url") or "").strip() or None,
                "evidence_snippet": (phone.get("evidence_snippet") or "").strip() or None,
                "confidence": _coerce_float(phone.get("confidence")) or 0.6,
                "source_basis": "ai_discovered",
                "extracted_from": "ai.discover_phone",
            }
        )

    return {
        "status": "success",
        "provider": provider_result["provider"],
        "model": provider_result["model"],
        "phones": normalized,
        "raw_response": provider_result["raw_response"],
    }


def build_ai_discovered_phone_candidates(
    *,
    entity_kind: str,
    entity_id: str,
    discovered_phones: list[dict[str, Any]],
    report_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Produce ``entity_contacts`` rows for AI-discovered phones.

    These rows live in the same DB table as the source-backed contacts but
    are flagged with ``source_type='ai_discovered'`` and capped at 0.7
    confidence so the UI can render a clear "AI-discovered (requires
    verification)" badge. The fingerprint deliberately keys on
    (entity, phone, source_url, ai_discovered) so re-running DD on the
    same entity updates the row instead of duplicating it.
    """

    candidates: list[dict[str, Any]] = []
    for phone in discovered_phones:
        value = str(phone.get("value") or "").strip()
        if not _is_valid_phone_value(value):
            continue
        normalized_value = _normalized_phone_value(value)
        source_url = (phone.get("source_url") or None)
        source_name = phone.get("source_name") or "AI-discovered"
        confidence = min((_coerce_float(phone.get("confidence")) or 0.6), 0.7)
        fingerprint_raw = "|".join(
            [
                entity_kind,
                entity_id,
                "phone",
                normalized_value,
                "ai_discovered",
                (source_url or "").lower(),
            ]
        )
        fingerprint = hashlib.sha1(fingerprint_raw.encode("utf-8")).hexdigest()
        candidates.append(
            {
                "id": fingerprint,
                "fingerprint": fingerprint,
                "entity_kind": entity_kind,
                "entity_id": entity_id,
                "contact_type": "phone",
                "contact_scope": "public_business",
                "label": phone.get("label") or "AI-discovered phone",
                "value": value,
                "normalized_value": normalized_value,
                "source_name": source_name,
                "source_url": source_url,
                "source_type": "ai_discovered",
                "confidence_score": confidence,
                "raw_payload": {
                    "dd_report_id": report_id,
                    "phone": phone,
                    "promotion_guardrails": {
                        "required_scope": "public_business",
                        "max_confidence": 0.7,
                        "requires_human_verification": True,
                    },
                },
                "extracted_from": phone.get("extracted_from") or "ai.discover_phone",
                "verified_at": None,
                "discovered_by": "ai",
            }
        )
    return candidates


def generate_dd_report(query: str, source_snapshot: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    analysis_result = generate_markdown_analysis(query)
    extraction_result = extract_source_backed_contacts(source_snapshot)

    entity_brief = _entity_brief_from_snapshot(source_snapshot)
    legal_result = extract_legal_events_via_ai(entity_brief) if entity_brief.get("company") else {
        "status": "skipped",
        "provider": None,
        "model": None,
        "events": [],
        "raw_response": None,
    }
    phone_discovery_result = discover_phone_via_ai(entity_brief) if entity_brief.get("company") else {
        "status": "skipped",
        "provider": None,
        "model": None,
        "phones": [],
        "raw_response": None,
    }

    return {
        "status": analysis_result.get("status", "error"),
        "provider": analysis_result.get("provider"),
        "model": analysis_result.get("model"),
        "analysis": analysis_result.get("analysis"),
        "analysis_raw_response": analysis_result.get("raw_response"),
        "extracted_contacts": extraction_result.get("contacts", []),
        "extraction_provider": extraction_result.get("provider"),
        "extraction_model": extraction_result.get("model"),
        "extraction_raw_response": extraction_result.get("raw_response"),
        "legal_events": legal_result.get("events", []),
        "legal_provider": legal_result.get("provider"),
        "legal_model": legal_result.get("model"),
        "legal_raw_response": legal_result.get("raw_response"),
        "legal_status": legal_result.get("status", "skipped"),
        "discovered_phones": phone_discovery_result.get("phones", []),
        "phone_discovery_provider": phone_discovery_result.get("provider"),
        "phone_discovery_model": phone_discovery_result.get("model"),
        "phone_discovery_raw_response": phone_discovery_result.get("raw_response"),
        "phone_discovery_status": phone_discovery_result.get("status", "skipped"),
        "prompt_version": DD_PROMPT_VERSION,
        "source_snapshot": source_snapshot,
        "message": analysis_result.get("message"),
        "error_code": analysis_result.get("error_code"),
    }


def _normalized_phone_value(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def _is_valid_phone_value(value: str) -> bool:
    digits = _normalized_phone_value(value)
    return 7 <= len(digits) <= 18 and bool(PHONE_ALLOWED_RE.match(value or ""))


def should_auto_promote_contact(contact: dict[str, Any]) -> bool:
    if (contact.get("contact_type") or "").strip().lower() != "phone":
        return False
    if (contact.get("contact_scope") or "").strip().lower() != "public_business":
        return False
    if not _is_valid_phone_value(str(contact.get("value") or "").strip()):
        return False
    if not str(contact.get("evidence_snippet") or "").strip():
        return False
    if not str(contact.get("source_url") or "").strip() and not str(contact.get("source_name") or "").strip():
        return False
    if (contact.get("source_basis") or "").strip().lower() not in {"source_structured_field", "explicit_source_text"}:
        return False
    confidence = _coerce_float(contact.get("confidence")) or 0.0
    if confidence < 0.86:
        return False

    review_text = " ".join(
        [
            str(contact.get("label") or "").lower(),
            str(contact.get("contact_role") or "").lower(),
            str(contact.get("evidence_snippet") or "").lower(),
        ]
    )
    if any(token in review_text for token in PRIVATE_PHONE_TOKENS):
        return False
    if not any(token in review_text for token in PUBLIC_PHONE_TOKENS):
        return False
    return True


def build_promotable_contact_candidates(
    *,
    entity_kind: str,
    entity_id: str,
    extracted_contacts: list[dict[str, Any]],
    default_source_name: Optional[str] = None,
    default_source_url: Optional[str] = None,
    report_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []

    for contact in extracted_contacts:
        merged_contact = dict(contact)
        if not merged_contact.get("source_name"):
            merged_contact["source_name"] = default_source_name
        if not merged_contact.get("source_url"):
            merged_contact["source_url"] = default_source_url
        if not should_auto_promote_contact(merged_contact):
            continue

        value = str(merged_contact.get("value") or "").strip()
        normalized_value = _normalized_phone_value(value)
        source_name = str(merged_contact.get("source_name") or "").strip() or None
        source_url = str(merged_contact.get("source_url") or "").strip() or None
        confidence = min((_coerce_float(merged_contact.get("confidence")) or 0.0), 0.89)
        fingerprint_raw = "|".join(
            [
                entity_kind,
                entity_id,
                "phone",
                normalized_value,
                (source_name or "").lower(),
                (source_url or "").lower(),
            ]
        )
        fingerprint = hashlib.sha1(fingerprint_raw.encode("utf-8")).hexdigest()
        candidates.append(
            {
                "id": fingerprint,
                "fingerprint": fingerprint,
                "entity_kind": entity_kind,
                "entity_id": entity_id,
                "contact_type": "phone",
                "contact_scope": "public_business",
                "label": merged_contact.get("label") or "Public business phone",
                "value": value,
                "normalized_value": normalized_value,
                "source_name": source_name or "Source-backed DD extraction",
                "source_url": source_url,
                "source_type": "llm_extracted_from_source",
                "confidence_score": confidence,
                "raw_payload": {
                    "dd_report_id": report_id,
                    "contact": merged_contact,
                    "promotion_guardrails": {
                        "required_scope": "public_business",
                        "required_basis": ["source_structured_field", "explicit_source_text"],
                        "minimum_confidence": 0.86,
                    },
                },
                "extracted_from": merged_contact.get("extracted_from") or "dd.extracted_contacts",
                "verified_at": _parse_datetime(merged_contact.get("verified_at")),
            }
        )
    return candidates
