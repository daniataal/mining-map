"""Tests for EU procurement entity matching."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

from backend.services import eu_procurement_intel as intel


class EuProcurementIntelTests(unittest.TestCase):
    def test_names_match_substring(self):
        self.assertTrue(intel._names_match("Boliden Mineral AB", "Boliden"))
        self.assertTrue(intel._names_match("ACME Mining LLC", "ACME Mining"))
        self.assertFalse(intel._names_match("", "Boliden"))

    @patch("backend.services.eu_procurement_intel.list_notices")
    def test_collect_for_company(self, mock_list):
        mock_list.return_value = [
            {
                "notice_id": "1-2024",
                "title": "Boliden copper services",
                "buyer": "SGU",
                "country": "Sweden",
                "cpv": "09120000",
            },
            {
                "notice_id": "2-2024",
                "title": "Unrelated tender",
                "buyer": "Other Corp",
                "country": "Germany",
                "cpv": "09120000",
            },
        ]
        conn = MagicMock()
        payload = intel.collect_eu_procurement_for_company(
            conn, company_name="Boliden", country="Sweden", limit=10
        )
        self.assertEqual(payload["summary"]["notice_count"], 1)
        self.assertEqual(payload["notices"][0]["notice_id"], "1-2024")


if __name__ == "__main__":
    unittest.main()
