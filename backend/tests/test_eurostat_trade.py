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

    def test_dimensional_json_stat(self) -> None:
        payload = {
            "id": ["geo", "partner", "TIME_PERIOD"],
            "size": [1, 2, 2],
            "dimension": {
                "geo": {
                    "category": {
                        "index": {"EU27_2020": 0},
                        "label": {"EU27_2020": "European Union - 27 countries"},
                    }
                },
                "partner": {
                    "category": {
                        "index": {"RU": 0, "NO": 1},
                        "label": {"RU": "Russia", "NO": "Norway"},
                    }
                },
                "TIME_PERIOD": {
                    "category": {
                        "index": {"2023": 0, "2024": 1},
                        "label": {"2023": "2023", "2024": "2024"},
                    }
                },
            },
            "value": {"0": 100.0, "1": 200.0, "2": 150.0, "3": 250.0},
        }
        rows = _parse_eurostat_json(payload)
        self.assertEqual(len(rows), 4)
        # JSON-stat: last dimension (TIME_PERIOD) varies fastest
        by_partner_year = {(r["partner"], r["year"]): r for r in rows}
        self.assertEqual(by_partner_year[("Russia", 2023)]["trade_value_usd"], 100_000.0)
        self.assertEqual(by_partner_year[("Russia", 2024)]["trade_value_usd"], 200_000.0)
        self.assertEqual(by_partner_year[("Norway", 2023)]["trade_value_usd"], 150_000.0)
        self.assertEqual(by_partner_year[("Norway", 2024)]["trade_value_usd"], 250_000.0)
        self.assertEqual(rows[0]["reporter_iso2"], "EU")
        self.assertIn("partner", rows[0]["raw"]["dimensions"])


class TestSyncSkippedWhenDisabled(unittest.TestCase):
    def test_disabled_returns_skipped(self) -> None:
        try:
            import backend.services.eurostat_trade as et  # type: ignore
        except ImportError:
            import services.eurostat_trade as et  # type: ignore

        old = et.EUROSTAT_ENABLED
        try:
            et.EUROSTAT_ENABLED = False
            result = sync_eurostat_hs27(None)  # type: ignore[arg-type]
            self.assertEqual(result["status"], "skipped")
        finally:
            et.EUROSTAT_ENABLED = old


class TestRecordEurostatSync(unittest.TestCase):
    def test_writes_sync_state(self) -> None:
        try:
            from backend.services.eurostat_trade import _record_eurostat_sync
        except ImportError:
            from services.eurostat_trade import _record_eurostat_sync  # type: ignore

        executed: list[tuple] = []

        class _Cur:
            def execute(self, sql: str, params: tuple) -> None:
                executed.append((sql.strip(), params))

            def __enter__(self):
                return self

            def __exit__(self, *args: object) -> None:
                return None

        class _Conn:
            def cursor(self) -> _Cur:
                return _Cur()

        _record_eurostat_sync(_Conn(), {"status": "ok", "rows_upserted": 3})
        self.assertEqual(len(executed), 1)
        self.assertIn("last_eurostat_sync", executed[0][0])
        self.assertIn('"status": "ok"', executed[0][1][0])


if __name__ == "__main__":
    unittest.main()
