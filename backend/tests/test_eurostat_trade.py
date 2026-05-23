"""Tests for eurostat_trade JSON parse (no live API)."""

from __future__ import annotations

import unittest

try:
    from backend.services.eurostat_trade import _parse_eurostat_json, sync_eurostat_hs27
except ImportError:
    from services.eurostat_trade import _parse_eurostat_json, sync_eurostat_hs27  # type: ignore


class TestParseEurostatJson(unittest.TestCase):
    def test_empty_payload(self) -> None:
        self.assertEqual(_parse_eurostat_json({}), [])
        self.assertEqual(_parse_eurostat_json({"value": None}), [])

    def test_parses_numeric_values(self) -> None:
        rows = _parse_eurostat_json({"value": {"0": 12.5, "1": "not-a-number", "2": None}})
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["data_source"], "eurostat")
        self.assertEqual(row["bol_tier"], "macro")
        self.assertEqual(row["hs_code"], "2709")
        self.assertEqual(row["trade_value_usd"], 12_500.0)

    def test_caps_at_500_keys(self) -> None:
        value = {str(i): float(i) for i in range(600)}
        rows = _parse_eurostat_json({"value": value})
        self.assertEqual(len(rows), 500)


class TestSyncSkippedWhenDisabled(unittest.TestCase):
    def test_disabled_returns_skipped(self) -> None:
        import backend.services.eurostat_trade as et  # type: ignore

        old = et.EUROSTAT_ENABLED
        try:
            et.EUROSTAT_ENABLED = False
            result = sync_eurostat_hs27(None)  # type: ignore[arg-type]
            self.assertEqual(result["status"], "skipped")
        finally:
            et.EUROSTAT_ENABLED = old


if __name__ == "__main__":
    unittest.main()
