from backend.services.dd.orchestrator import (
    build_promotable_contact_candidates,
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
