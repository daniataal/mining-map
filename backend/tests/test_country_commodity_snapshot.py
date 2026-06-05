"""Tests for country + commodity snapshot aggregation."""

from __future__ import annotations

import unittest

try:
    from backend.services.country_commodity_snapshot import (
        _aggregate_trade,
        _commodity_matches_field,
        _flow_kind,
        serialize_country_commodity_snapshot,
    )
except ImportError:
    from services.country_commodity_snapshot import (  # type: ignore
        _aggregate_trade,
        _commodity_matches_field,
        _flow_kind,
        serialize_country_commodity_snapshot,
    )


class TestFlowKind(unittest.TestCase):
    def test_export_and_import_codes(self) -> None:
        self.assertEqual(_flow_kind("X"), "export")
        self.assertEqual(_flow_kind("M"), "import")


class TestAggregateTrade(unittest.TestCase):
    def test_sums_latest_year_exports(self) -> None:
        flows = [
            {
                "partner": "China",
                "flow_type": "X",
                "year": 2023,
                "trade_value_usd": 1_000_000,
                "data_source": "comtrade",
            },
            {
                "partner": "USA",
                "flow_type": "X",
                "year": 2023,
                "trade_value_usd": 500_000,
                "data_source": "comtrade",
            },
            {
                "partner": "China",
                "flow_type": "M",
                "year": 2023,
                "trade_value_usd": 200_000,
                "data_source": "comtrade",
            },
            {
                "partner": "JODI",
                "flow_type": "M",
                "year": 2023,
                "trade_value_usd": 9_999,
                "data_source": "jodi",
            },
            {
                "partner": "India",
                "flow_type": "X",
                "year": 2021,
                "trade_value_usd": 1,
                "data_source": "comtrade",
            },
        ]
        agg = _aggregate_trade(flows)
        self.assertEqual(agg["latest_year"], 2023)
        self.assertEqual(agg["export_usd"], 1_500_000)
        self.assertEqual(agg["import_usd"], 200_000)
        self.assertEqual(len(agg["top_export_partners"]), 2)
        self.assertEqual(agg["top_export_partners"][0]["partner"], "China")

    def test_empty_when_only_jodi(self) -> None:
        agg = _aggregate_trade(
            [{"data_source": "jodi", "flow_type": "M", "year": 2023, "trade_value_usd": 1}]
        )
        self.assertIsNone(agg["export_usd"])
        self.assertEqual(agg["data_sources"], [])


class TestCommodityMatch(unittest.TestCase):
    def test_diesel_matches_oil_field(self) -> None:
        self.assertTrue(_commodity_matches_field("diesel", "Oil"))

    def test_gold_does_not_match_gas(self) -> None:
        self.assertFalse(_commodity_matches_field("gold", "gas"))


class TestSerialize(unittest.TestCase):
    def test_camel_case_keys(self) -> None:
        out = serialize_country_commodity_snapshot(
            {
                "entityId": "x",
                "entityKind": "license",
                "country": "Ghana",
                "commodity": "Gold",
                "hs_codes": ["7108"],
                "trade": {
                    "latest_year": 2022,
                    "export_usd": 100.0,
                    "import_usd": None,
                    "export_kg": None,
                    "import_kg": None,
                    "top_export_partners": [],
                    "top_import_partners": [],
                    "data_sources": ["comtrade"],
                },
                "extraction": {
                    "available": False,
                    "tier": "none",
                    "field_count": 0,
                    "limitations": [],
                },
                "warnings": [],
                "limitations": [],
            }
        )
        self.assertEqual(out["hsCodes"], ["7108"])
        self.assertEqual(out["trade"]["latestYear"], 2022)
        self.assertEqual(out["trade"]["exportUsd"], 100.0)


if __name__ == "__main__":
    unittest.main()
