"""Mocked tests for Wikidata company enrichment (no network)."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

try:
    from backend.services import wikidata_company_enrichment as wd_mod
except ImportError:  # pragma: no cover
    from services import wikidata_company_enrichment as wd_mod  # type: ignore


class _FakeResponse:
    def __init__(self, payload):
        self.status_code = 200
        self._payload = payload

    def json(self):
        return self._payload


def _make_get_factory(responses_by_action):
    """Build a fake ``requests.get`` that dispatches by ``action`` param."""

    def _get(url, params=None, headers=None, timeout=None):
        action = (params or {}).get("action")
        return _FakeResponse(responses_by_action.get(action, {}))

    return _get


class LookupCompanyTests(unittest.TestCase):
    def test_lookup_returns_qid_and_facts(self):
        search_payload = {
            "search": [{"id": "Q12345", "label": "Acme Corp", "description": "Oil major"}]
        }
        entity_payload = {
            "entities": {
                "Q12345": {
                    "claims": {
                        "P1278": [
                            {
                                "mainsnak": {
                                    "snaktype": "value",
                                    "datavalue": {"value": "549300LEIVALUE0000"},
                                }
                            }
                        ],
                        "P452": [
                            {
                                "mainsnak": {
                                    "snaktype": "value",
                                    "datavalue": {"value": {"id": "Q1000"}},
                                }
                            }
                        ],
                        "P17": [
                            {
                                "mainsnak": {
                                    "snaktype": "value",
                                    "datavalue": {"value": {"id": "Q30"}},
                                }
                            }
                        ],
                        "P856": [
                            {
                                "mainsnak": {
                                    "snaktype": "value",
                                    "datavalue": {"value": "https://acme.example"},
                                }
                            }
                        ],
                    },
                    "descriptions": {"en": {"value": "Oil major"}},
                }
            }
        }
        label_payload = {
            "entities": {
                "Q1000": {"labels": {"en": {"value": "oil and gas industry"}}},
                "Q30": {"labels": {"en": {"value": "United States"}}},
            }
        }

        call_count = {"n": 0}

        def _get(url, params=None, headers=None, timeout=None):
            call_count["n"] += 1
            action = (params or {}).get("action")
            if action == "wbsearchentities":
                return _FakeResponse(search_payload)
            if action == "wbgetentities" and (params.get("props") or "").startswith(
                "claims"
            ):
                return _FakeResponse(entity_payload)
            return _FakeResponse(label_payload)

        with patch.object(wd_mod, "requests") as mock_requests:
            mock_requests.get.side_effect = _get
            out = wd_mod.lookup_company("Acme Corp")

        self.assertIsNotNone(out)
        self.assertEqual(out["qid"], "Q12345")
        facts = out["facts"]
        self.assertEqual(facts["lei"], "549300LEIVALUE0000")
        self.assertEqual(facts["country"], "United States")
        self.assertEqual(facts["website"], "https://acme.example")
        self.assertIn("oil and gas industry", facts["industries"])

    def test_lookup_empty_name(self):
        self.assertIsNone(wd_mod.lookup_company("  "))

    def test_lookup_no_match_returns_none(self):
        with patch.object(wd_mod, "requests") as mock_requests:
            mock_requests.get.return_value = _FakeResponse({"search": []})
            self.assertIsNone(wd_mod.lookup_company("ZZZ"))


class BatchEnrichTests(unittest.TestCase):
    def _mock_conn(self, *, has_columns=True, rows=None):
        conn = MagicMock()
        cur = MagicMock()
        cur.__enter__.return_value = cur
        cur.__exit__.return_value = False
        conn.cursor.return_value = cur
        cur.fetchone.return_value = (1,) if has_columns else None
        cur.fetchall.return_value = rows or []
        return conn, cur

    def test_skip_when_missing_columns(self):
        conn, _ = self._mock_conn(has_columns=False)
        out = wd_mod.enrich_companies_with_wikidata(conn, limit=10, throttle_seconds=0)
        self.assertEqual(out["status"], "skipped")
        self.assertTrue(out["skipped_missing_columns"])

    def test_updates_rows_on_match(self):
        rows = [("id-1", "Acme Corp"), ("id-2", "Beta LLC")]
        conn, cur = self._mock_conn(has_columns=True, rows=rows)

        def _lookup(name):
            if name == "Acme Corp":
                return {"qid": "Q12345", "label": name, "facts": {"country": "US"}}
            return None

        with patch.object(wd_mod, "lookup_company", side_effect=_lookup):
            out = wd_mod.enrich_companies_with_wikidata(
                conn, limit=10, throttle_seconds=0
            )

        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["qid_written"], 1)
        self.assertEqual(out["no_match"], 1)


if __name__ == "__main__":
    unittest.main()
