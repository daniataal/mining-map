import unittest
from unittest.mock import patch

from backend.services.gleif_lookup import lookup_lei


class GleifLookupTests(unittest.TestCase):
    @patch("backend.services.gleif_lookup._fetch_lei_search")
    def test_lookup_returns_matches(self, mock_fetch):
        mock_fetch.return_value = {
            "data": [
                {
                    "id": "5493000IBP32UQZ0KL24",
                    "attributes": {
                        "lei": "5493000IBP32UQZ0KL24",
                        "entity": {
                            "legalName": {"name": "ACME MINING CORP"},
                            "legalAddress": {"country": "US"},
                        },
                        "registration": {"status": "ISSUED"},
                    },
                }
            ]
        }
        out = lookup_lei("ACME Mining Corp", force_refresh=True)
        self.assertEqual(out["status"], "success")
        self.assertEqual(out["match_count"], 1)
        self.assertEqual(out["matches"][0]["lei"], "5493000IBP32UQZ0KL24")
        self.assertIn("gleif.org", out["matches"][0]["gleif_url"])

    def test_empty_name_errors(self):
        out = lookup_lei("  ")
        self.assertEqual(out["status"], "error")


if __name__ == "__main__":
    unittest.main()
