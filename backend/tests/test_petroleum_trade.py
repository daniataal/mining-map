"""
Tests for the free / open-source petroleum trade-flow fallback chain.

The tests stub out the HTTP layer (``_http_get_json``) so they exercise
the orchestrator's branching logic deterministically without hitting any
upstream service.  ``COMTRADE_API_KEY`` and ``EIA_API_KEY`` are explicitly
unset in each test to mirror the user's environment (no paid keys).
"""

import os
import unittest
from unittest import mock

from backend.services import petroleum_trade as pt


class _BaseTrade(unittest.TestCase):
    def setUp(self) -> None:
        # Wipe the in-process TTL cache between tests so each scenario
        # starts from a known state.
        pt.clear_cache()
        # Strip both keys — we are testing the *no-paid-key* path.
        self._prev_comtrade = os.environ.pop("COMTRADE_API_KEY", None)
        self._prev_comtrade_secondary = os.environ.pop("COMTRADE_API_KEY_SECONDARY", None)
        self._prev_eia = os.environ.pop("EIA_API_KEY", None)

    def tearDown(self) -> None:
        pt.clear_cache()
        if self._prev_comtrade is not None:
            os.environ["COMTRADE_API_KEY"] = self._prev_comtrade
        else:
            os.environ.pop("COMTRADE_API_KEY", None)
        if self._prev_comtrade_secondary is not None:
            os.environ["COMTRADE_API_KEY_SECONDARY"] = self._prev_comtrade_secondary
        else:
            os.environ.pop("COMTRADE_API_KEY_SECONDARY", None)
        if self._prev_eia is not None:
            os.environ["EIA_API_KEY"] = self._prev_eia


class ComtradePublicPreviewTests(_BaseTrade):
    """The public preview endpoint must be reachable without any key."""

    def test_public_preview_returns_normalized_flows(self):
        sample = {
            "data": [
                {
                    "flowCode": "X",
                    "primaryValue": 102_000_000_000,
                    "netWgt": 157_000_000_000,
                    "qty": 1_200_000,
                    "qtyUnitAbbr": "TONS",
                    "partnerDesc": "World",
                    "period": 2023,
                },
                {
                    "flowCode": "M",
                    "primaryValue": 13_000_000_000,
                    "netWgt": 18_000_000_000,
                    "partnerDesc": "World",
                    "period": 2023,
                },
            ]
        }
        with mock.patch.object(pt, "_http_get_json", return_value=sample) as http:
            out = pt.fetch_comtrade_public("124", "2709", year=2023)

        # No key was provided — the URL must hit the public endpoint.
        http.assert_called_once()
        called_url = http.call_args[0][0]
        self.assertIn("comtradeapi.un.org/public/v1/preview", called_url)
        self.assertNotIn("subscription-key", called_url)

        self.assertEqual(out["source_key"], "comtrade_public")
        self.assertFalse(out["key_required"])
        self.assertEqual(len(out["flows"]), 2)
        self.assertEqual(out["flows"][0]["flow"], "Export")
        self.assertEqual(out["flows"][0]["trade_value_usd"], 102_000_000_000)
        self.assertEqual(out["flows"][1]["flow"], "Import")

    def test_public_preview_year_backoff_when_empty(self):
        # First call (year=2023) returns empty; second call (2022) returns data.
        empty = {"data": []}
        non_empty = {
            "data": [
                {
                    "flowCode": "X",
                    "primaryValue": 90,
                    "netWgt": 100,
                    "partnerDesc": "World",
                    "period": 2022,
                }
            ]
        }
        with mock.patch.object(
            pt, "_http_get_json", side_effect=[empty, non_empty]
        ) as http:
            out = pt.fetch_comtrade_public("578", "2709", year=2023)
        self.assertEqual(http.call_count, 2)
        self.assertEqual(out["year"], 2022)
        self.assertEqual(len(out["flows"]), 1)


class OrchestratorTests(_BaseTrade):
    """End-to-end fallback chain logic via ``fetch_petroleum_trade``."""

    def test_canada_crude_uses_public_preview_no_key_required(self):
        # Comtrade public preview returns rows — primary source.
        sample = {
            "data": [
                {
                    "flowCode": "X",
                    "primaryValue": 102_000_000_000,
                    "netWgt": 157_000_000_000,
                    "partnerDesc": "World",
                    "period": 2023,
                }
            ]
        }
        with mock.patch.object(pt, "_http_get_json", return_value=sample):
            out = pt.fetch_petroleum_trade("124", "CA", "2709", year=2023)

        self.assertTrue(out["flows"])
        self.assertEqual(out["source_key"], "comtrade_public")
        self.assertFalse(out["key_required"])
        self.assertIn("UN Comtrade", out["source"])

    def test_seed_fallback_when_all_upstreams_fail(self):
        # Every HTTP call fails → orchestrator must reach the curated seed.
        with mock.patch.object(pt, "_http_get_json", return_value=None):
            out = pt.fetch_petroleum_trade("124", "CA", "2709", year=2023)

        self.assertTrue(out["flows"])
        self.assertEqual(out["source_key"], "seed")
        self.assertEqual(out["year"], 2022)
        self.assertEqual(out["flows"][0]["flow"], "Export")
        self.assertEqual(
            out["flows"][0]["trade_value_usd"],
            pt.SEED_PETROLEUM_FLOWS[("124", "2709")]["value_usd"],
        )

    def test_unknown_reporter_returns_empty(self):
        # ZZ / m49=999 isn't in the seed and the HTTP layer fails.
        with mock.patch.object(pt, "_http_get_json", return_value=None):
            out = pt.fetch_petroleum_trade("999", "ZZ", "2709", year=2023)
        self.assertEqual(out, {})

    def test_comtrade_keyed_preferred_when_key_present(self):
        os.environ["COMTRADE_API_KEY"] = "test-key"
        try:
            sample = {
                "data": [
                    {
                        "flowCode": "X",
                        "primaryValue": 200,
                        "netWgt": 1,
                        "partnerDesc": "World",
                        "period": 2023,
                    }
                ]
            }
            with mock.patch.object(pt, "_http_get_json", return_value=sample) as http:
                out = pt.fetch_petroleum_trade("124", "CA", "2709", year=2023)
            self.assertEqual(out["source_key"], "comtrade_keyed")
            self.assertTrue(out["key_required"])
            called_url = http.call_args[0][0]
            self.assertIn("subscription-key=test-key", called_url)
        finally:
            os.environ.pop("COMTRADE_API_KEY", None)


class CommodityHsResolutionTests(unittest.TestCase):
    """The petroleum HS mapping must include the OilTradeContext labels."""

    def test_petroleum_hs_codes_constant(self):
        self.assertEqual(
            set(pt.PETROLEUM_HS_CODES.keys()),
            {"2709", "2710", "2711"},
        )


if __name__ == "__main__":
    unittest.main()
