"""Tests for SEC EDGAR company lookup."""

from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

from backend.services.sec_edgar_lookup import lookup_sec_company


MOCK_TICKERS = {
    "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
    "1": {"cik_str": 789019, "ticker": "MSFT", "title": "MICROSOFT CORP"},
}


class SecEdgarLookupTests(unittest.TestCase):
    @patch("backend.services.sec_edgar_lookup._cached_tickers")
    def test_lookup_finds_apple(self, mock_cache):
        mock_cache.return_value = list(MOCK_TICKERS.values())
        result = lookup_sec_company("Apple Inc")
        self.assertEqual(result["status"], "success")
        self.assertIsNotNone(result["best_match"])
        self.assertEqual(result["best_match"]["ticker"], "AAPL")
        self.assertIn("sec.gov", result["best_match"]["edgar_url"])

    @patch("backend.services.sec_edgar_lookup.urlopen")
    def test_fetch_parses_json(self, mock_urlopen):
        from backend.services import sec_edgar_lookup as mod

        mod._ticker_cache["loaded_at"] = 0
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(MOCK_TICKERS).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        rows = mod._fetch_company_tickers()
        self.assertEqual(len(rows), 2)


if __name__ == "__main__":
    unittest.main()
