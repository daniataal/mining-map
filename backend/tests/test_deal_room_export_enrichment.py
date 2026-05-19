"""Tests for deal room export procurement enrichment."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

from backend.services.deal_room_export_enrichment import (
    collect_party_names,
    enrich_deal_room_export,
    names_match,
)


class DealRoomExportEnrichmentTests(unittest.TestCase):
    def test_names_match_substring(self):
        self.assertTrue(names_match("Newmont Corporation", "NEWMONT CORP"))

    def test_collect_party_names(self):
        room = {"title": "Acme JV Investigation", "evidence": {}}
        entity = {"company": "Acme Mining Ltd"}
        names = collect_party_names(room, entity)
        self.assertIn("Acme Mining Ltd", names)
        self.assertIn("Acme JV Investigation", names)

    @patch("backend.services.eu_procurement_intel.collect_eu_procurement_for_company")
    @patch("backend.services.gov_procurement_store.list_awards_for_company")
    @patch("backend.services.gov_procurement_store.ensure_gov_procurement_tables")
    def test_enrich_deal_room_export(self, _ensure, mock_awards, mock_eu):
        mock_awards.return_value = [{"award_id": "A1", "recipient_name": "Acme Mining Ltd", "value": 1000}]
        mock_eu.return_value = {
            "notices": [{"notice_id": "ND-1", "title": "Acme Mining equipment", "buyer": "EU buyer"}],
            "warnings": [],
        }
        conn = MagicMock()
        room = {"title": "Deal", "evidence": {}}
        entity = {"company": "Acme Mining Ltd", "country": "United States"}
        out = enrich_deal_room_export(conn, room=room, entity=entity, limit=10)
        self.assertEqual(len(out["relatedUsaAwards"]), 1)
        self.assertEqual(len(out["relatedEuNotices"]), 1)


if __name__ == "__main__":
    unittest.main()
