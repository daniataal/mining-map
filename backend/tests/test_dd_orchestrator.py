from unittest.mock import patch

from backend.services.ai_providers import _env_secret
from backend.services.dd.orchestrator import (
    _ai_analysis_deadline_seconds,
    _ai_http_extra_retries,
    _ai_http_timeout_seconds,
    _pollinations_http_extra_retries,
    _pollinations_http_timeout_seconds,
    build_ai_discovered_phone_candidates,
    build_promotable_contact_candidates,
    generate_dd_report,
    generate_markdown_analysis,
    normalize_extracted_contacts,
    should_auto_promote_contact,
)


def test_normalize_extracted_contacts_accepts_camel_case_fields():
    contacts = normalize_extracted_contacts(
        [
            {
                "contactType": "telephone",
                "value": "+233 30 000 0001",
                "label": "Head office",
                "contactScope": "public_business",
                "contactRole": "office",
                "sourceName": "Registry record",
                "sourceUrl": "https://example.com/record",
                "evidenceSnippet": "Head office: +233 30 000 0001",
                "extractedFrom": "raw_payload.description",
                "sourceBasis": "explicit_source_text",
                "confidence": 0.91,
            }
        ]
    )

    assert contacts == [
        {
            "contact_type": "phone",
            "value": "+233 30 000 0001",
            "label": "Head office",
            "contact_scope": "public_business",
            "contact_role": "office",
            "source_name": "Registry record",
            "source_url": "https://example.com/record",
            "evidence_snippet": "Head office: +233 30 000 0001",
            "extracted_from": "raw_payload.description",
            "source_basis": "explicit_source_text",
            "confidence": 0.91,
            "verified_at": None,
        }
    ]


def test_auto_promote_requires_public_business_guardrails():
    promotable_contact = {
        "contact_type": "phone",
        "value": "+233 30 000 0001",
        "label": "Head office",
        "contact_scope": "public_business",
        "contact_role": "office",
        "source_name": "Registry record",
        "source_url": "https://example.com/record",
        "evidence_snippet": "Head office: +233 30 000 0001",
        "extracted_from": "raw_payload.description",
        "source_basis": "explicit_source_text",
        "confidence": 0.91,
    }
    private_contact = {
        **promotable_contact,
        "label": "WhatsApp",
        "contact_role": "mobile",
        "evidence_snippet": "WhatsApp: +233 30 000 0001",
    }

    assert should_auto_promote_contact(promotable_contact) is True
    assert should_auto_promote_contact(private_contact) is False


def test_build_promotable_contact_candidates_returns_source_backed_phone_only():
    candidates = build_promotable_contact_candidates(
        entity_kind="license",
        entity_id="license-123",
        extracted_contacts=[
            {
                "contact_type": "phone",
                "value": "+233 30 000 0001",
                "label": "Head office",
                "contact_scope": "public_business",
                "contact_role": "office",
                "source_name": "Registry record",
                "source_url": "https://example.com/record",
                "evidence_snippet": "Head office: +233 30 000 0001",
                "extracted_from": "raw_payload.description",
                "source_basis": "explicit_source_text",
                "confidence": 0.91,
            },
            {
                "contact_type": "email",
                "value": "ops@example.com",
                "label": "Operations",
                "contact_scope": "public_business",
                "source_name": "Registry record",
                "source_url": "https://example.com/record",
                "evidence_snippet": "Email: ops@example.com",
                "source_basis": "explicit_source_text",
                "confidence": 0.95,
            },
        ],
        report_id="dd-report-1",
    )

    assert len(candidates) == 1
    assert candidates[0]["contact_type"] == "phone"
    assert candidates[0]["source_type"] == "llm_extracted_from_source"
    assert candidates[0]["normalized_value"] == "233300000001"
    assert candidates[0]["raw_payload"]["dd_report_id"] == "dd-report-1"
    assert candidates[0]["raw_payload"]["contact"]["value"] == "+233 30 000 0001"


def test_build_ai_discovered_phone_candidates_marks_provenance_and_caps_confidence():
    candidates = build_ai_discovered_phone_candidates(
        entity_kind="license",
        entity_id="license-xyz",
        discovered_phones=[
            {
                "value": "+233 30 222 3344",
                "label": "Head office",
                "contact_role": "office",
                "source_name": "Company website",
                "source_url": "https://acmemining.example/contact",
                "evidence_snippet": "Call our head office: +233 30 222 3344",
                "confidence": 0.95,
            },
            {
                # Not a valid phone (too short) — should be dropped.
                "value": "1234",
                "source_name": "Bad src",
            },
        ],
        report_id="report-42",
    )

    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["source_type"] == "ai_discovered"
    assert candidate["discovered_by"] == "ai"
    # AI-discovered candidates are capped at 0.7 so they never out-rank
    # source-backed contacts in the dossier list ordering.
    assert candidate["confidence_score"] <= 0.7
    assert candidate["raw_payload"]["dd_report_id"] == "report-42"
    assert candidate["raw_payload"]["promotion_guardrails"]["requires_human_verification"] is True
    assert candidate["normalized_value"] == "233302223344"
    assert candidate["extracted_from"] == "ai.discover_phone"


def test_ai_http_defaults_are_ui_friendly():
    assert _ai_http_timeout_seconds() == 18.0
    assert _ai_http_extra_retries() == 1
    assert _pollinations_http_timeout_seconds() == 12.0
    assert _pollinations_http_extra_retries() == 0
    assert _ai_analysis_deadline_seconds() == 45.0


def test_generate_dd_report_skips_enrichment_when_analysis_fails():
    snapshot = {
        "entity": {"id": "lic-1", "company": "Acme Mining"},
        "source": {},
    }
    with patch(
        "backend.services.dd.orchestrator.generate_markdown_analysis",
        return_value={"status": "error", "analysis": None, "error_code": "AI_ALL_PROVIDERS_FAILED"},
    ), patch("backend.services.dd.orchestrator.extract_legal_events_via_ai") as legal_mock, patch(
        "backend.services.dd.orchestrator.discover_phone_via_ai"
    ) as phone_mock:
        report = generate_dd_report("query", snapshot)
    assert report["status"] == "error"
    legal_mock.assert_not_called()
    phone_mock.assert_not_called()


def test_generate_markdown_analysis_returns_fast_error_without_pollinations_when_disabled(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setenv("DISABLE_POLLINATIONS_FALLBACK", "1")
    with patch("backend.services.dd.orchestrator._run_provider_cascade", return_value=None):
        result = generate_markdown_analysis("test entity")
    assert result["status"] == "error"
    assert result["error_code"] == "AI_ALL_PROVIDERS_FAILED"
    assert "GROQ_API_KEY=MISSING" in (result.get("message") or "")
    assert "DISABLE_POLLINATIONS_FALLBACK=SET" in (result.get("message") or "")


def test_build_ai_discovered_phone_candidates_is_idempotent_per_source_url():
    first = build_ai_discovered_phone_candidates(
        entity_kind="license",
        entity_id="license-xyz",
        discovered_phones=[
            {
                "value": "+233 30 222 3344",
                "source_url": "https://acmemining.example/contact",
                "confidence": 0.9,
            }
        ],
        report_id="report-a",
    )
    second = build_ai_discovered_phone_candidates(
        entity_kind="license",
        entity_id="license-xyz",
        discovered_phones=[
            {
                "value": "+233 30 222 3344",
                "source_url": "https://acmemining.example/contact",
                "confidence": 0.5,
            }
        ],
        report_id="report-b",
    )
    assert first[0]["fingerprint"] == second[0]["fingerprint"]
