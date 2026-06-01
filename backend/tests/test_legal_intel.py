"""Unit tests for the legal-intelligence service.

These tests exercise the pure-Python normalisation + adapter glue with
zero DB / network dependencies. Live adapters (CourtListener etc.) are
exercised via injected callables so we can assert on shape without
hitting the wire.
"""

from __future__ import annotations

import json
import unittest
from datetime import date
from types import SimpleNamespace
from typing import Any

from backend.services import legal_intel
from backend.services.legal_intel import (
    collect_legal_events,
    fetch_courtlistener_events,
    fetch_opensanctions_adverse_events,
    normalize_legal_events,
    serialize_legal_event,
)


class NormalizeLegalEventsTests(unittest.TestCase):
    def test_role_normalisation_and_fingerprint_stability(self):
        events = normalize_legal_events(
            entity_kind="license",
            entity_id="lic-1",
            events=[
                {
                    "case_title": "ACME Mining v. Coltan Ltd",
                    "role": "Claimant",  # alias for plaintiff
                    "court": "Lagos Commercial Court",
                    "filed_date": "2023-06-04",
                    "status": "Settled",
                    "summary": "Contract dispute over offtake terms.",
                    "source_name": "Local registry",
                    "source_url": "https://example.gov/case/123",
                    "confidence": 0.81,
                    "parties": ["ACME Mining", "Coltan Ltd"],
                },
                {
                    # Missing case_title is dropped.
                    "role": "defendant",
                    "court": "ICSID",
                },
            ],
        )

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["role"], "plaintiff")
        self.assertEqual(event["status"], "settled")
        self.assertEqual(event["filed_date"], date(2023, 6, 4))
        self.assertEqual(event["entity_kind"], "license")
        self.assertEqual(event["entity_id"], "lic-1")
        self.assertEqual(event["parties"], "ACME Mining; Coltan Ltd")
        self.assertEqual(event["source_url"], "https://example.gov/case/123")
        self.assertGreater(len(event["fingerprint"]), 10)

        # Re-normalising the same payload must yield the same fingerprint
        # so the upsert path is idempotent.
        repeat = normalize_legal_events(
            entity_kind="license",
            entity_id="lic-1",
            events=[
                {
                    "case_title": "ACME Mining v. Coltan Ltd",
                    "role": "plaintiff",
                    "court": "Lagos Commercial Court",
                    "filed_date": "2023-06-04",
                }
            ],
        )
        self.assertEqual(repeat[0]["fingerprint"], event["fingerprint"])

    def test_unknown_status_falls_back_to_unknown(self):
        events = normalize_legal_events(
            entity_kind="license",
            entity_id="lic-2",
            events=[{"case_title": "Test Case", "status": "something else"}],
        )
        self.assertEqual(events[0]["status"], "unknown")

    def test_default_source_propagates_when_missing(self):
        events = normalize_legal_events(
            entity_kind="license",
            entity_id="lic-3",
            events=[{"case_title": "Case A"}],
            default_source_name="Stub",
            default_source_url="https://stub.example/case-a",
            default_discovered_by="ai",
            default_source_type="ai_extracted",
        )
        self.assertEqual(events[0]["source_name"], "Stub")
        self.assertEqual(events[0]["source_url"], "https://stub.example/case-a")
        self.assertEqual(events[0]["discovered_by"], "ai")
        self.assertEqual(events[0]["source_type"], "ai_extracted")


class CourtListenerAdapterTests(unittest.TestCase):
    def test_returns_empty_when_no_key(self):
        # Force the env-key path off; the helper must short-circuit.
        events = fetch_courtlistener_events(company_name="ACME", api_key="")
        self.assertEqual(events, [])

    def test_normalises_hits_when_key_and_http_injected(self):
        events = fetch_courtlistener_events(
            company_name="ACME",
            api_key="fake-token",
            http_get=lambda *a, **kw: SimpleNamespace(status_code=200, json=lambda: {"results": [{"caseName": "x"}]}),
        )
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["case_title"], "x")
        self.assertEqual(events[0]["discovered_by"], "court_listener")


class OpenSanctionsAdapterTests(unittest.TestCase):
    def test_returns_empty_when_no_key(self):
        events = fetch_opensanctions_adverse_events(company_name="ACME Corp", api_key="")
        self.assertEqual(events, [])

    def test_normalises_match_results_when_http_injected(self):
        payload = {
            "responses": {
                "q": {
                    "results": [
                        {
                            "id": "NK-test123",
                            "caption": "ACME Holdings Ltd",
                            "score": 0.88,
                            "target": True,
                            "first_seen": "2024-01-15",
                            "properties": {"topics": ["sanction", "debarment"]},
                            "datasets": ["us_ofac_sdn", "eu_fsf"],
                        }
                    ]
                }
            }
        }

        events = fetch_opensanctions_adverse_events(
            company_name="ACME Corp",
            country="Ghana",
            api_key="fake-key",
            http_post=lambda *a, **kw: SimpleNamespace(status_code=200, json=lambda: payload),
        )

        self.assertEqual(len(events), 1)
        self.assertIn("ACME Holdings Ltd", events[0]["case_title"])
        self.assertEqual(events[0]["role"], "regulatory_target")
        self.assertEqual(events[0]["discovered_by"], "opensanctions")
        self.assertEqual(events[0]["source_type"], "opensanctions")
        self.assertIn("opensanctions.org/entities/NK-test123", events[0]["source_url"])


class CollectLegalEventsTests(unittest.TestCase):
    def test_falls_back_to_stub_when_no_signals(self):
        events = collect_legal_events(
            entity_kind="license",
            entity_id="lic-99",
            entity={"company": "ACME Mining", "country": "Ghana"},
        )
        self.assertGreaterEqual(len(events), 1)
        self.assertTrue(
            all(event["source_type"] == "stub_fixture" for event in events),
            "Expected stub fixture when no live providers + no AI events were supplied",
        )
        self.assertTrue(any(event["role"] == "plaintiff" for event in events))
        self.assertTrue(any(event["role"] in {"respondent", "defendant"} for event in events))

    def test_merges_ai_events_into_pipeline(self):
        events = collect_legal_events(
            entity_kind="license",
            entity_id="lic-99",
            entity={"company": "ACME Mining", "country": "Ghana"},
            ai_extracted_events=[
                {
                    "case_title": "Regulator v. ACME Mining",
                    "role": "defendant",
                    "court": "Ghana High Court",
                    "filed_date": "2024-09-10",
                    "status": "open",
                    "source_name": "AI cross-reference",
                    "source_url": "https://example.gov/case/55",
                    "confidence": 0.74,
                }
            ],
        )
        ai_events = [event for event in events if event["case_title"] == "Regulator v. ACME Mining"]
        self.assertEqual(len(ai_events), 1)
        self.assertEqual(ai_events[0]["role"], "defendant")
        self.assertEqual(ai_events[0]["discovered_by"], "ai")


class SerializerTests(unittest.TestCase):
    def test_serializer_returns_camelcase_keys(self):
        row: dict[str, Any] = {
            "id": "abc",
            "fingerprint": "fp",
            "entity_kind": "license",
            "entity_id": "lic-1",
            "case_title": "Title",
            "parties": "A; B",
            "role": "plaintiff",
            "court": "Court",
            "jurisdiction": "GH",
            "filed_date": date(2024, 1, 2),
            "status": "open",
            "summary": "Summary",
            "source_name": "Src",
            "source_url": "https://example.com",
            "source_type": "ai_extracted",
            "discovered_by": "ai",
            "confidence_score": 0.7,
            "raw_payload": {"foo": "bar"},
            "last_seen_at": None,
            "created_at": None,
        }
        out = serialize_legal_event(row)
        self.assertEqual(out["caseTitle"], "Title")
        self.assertEqual(out["filedDate"], "2024-01-02")
        self.assertEqual(out["discoveredBy"], "ai")
        self.assertEqual(out["confidenceScore"], 0.7)


class FakeCursor:
    def __init__(self, sink):
        self._sink = sink

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self._sink.append((sql, params))

    def fetchall(self):
        return self._sink.get("rows", [])

    def fetchone(self):
        return None


class FakeConn:
    def __init__(self):
        self.executed: list[tuple[str, Any]] = []
        self.rolled_back = False
        self.committed = False

    def cursor(self, **kwargs):
        return FakeCursor(self.executed)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


class UpsertTests(unittest.TestCase):
    def test_upsert_uses_fingerprint_conflict_clause(self):
        conn = FakeConn()
        events = normalize_legal_events(
            entity_kind="license",
            entity_id="lic-x",
            events=[{"case_title": "Sample"}],
        )
        legal_intel.upsert_legal_events(conn, events)
        self.assertEqual(len(conn.executed), 1)
        sql, params = conn.executed[0]
        self.assertIn("ON CONFLICT (fingerprint) DO UPDATE", sql)
        # Confirm raw_payload is JSON-serialisable for the wrapper used in tests.
        json.dumps(events[0]["raw_payload"])


if __name__ == "__main__":
    unittest.main()
