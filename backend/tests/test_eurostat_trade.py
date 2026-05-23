"""Tests for eurostat_trade JSON parse (no live API)."""

from __future__ import annotations

import sys
import unittest
from unittest import mock
from unittest.mock import MagicMock

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

    def test_product_dimension_maps_hs_code(self) -> None:
        payload = {
            "id": ["geo", "product", "time"],
            "size": [1, 2, 1],
            "dimension": {
                "geo": {
                    "category": {
                        "index": {"DE": 0},
                        "label": {"DE": "Germany"},
                    }
                },
                "product": {
                    "category": {
                        "index": {"2709": 0, "2710": 1},
                        "label": {"2709": "Crude oil", "2710": "Refined products"},
                    }
                },
                "time": {
                    "category": {
                        "index": {"2024": 0},
                        "label": {"2024": "2024"},
                    }
                },
            },
            "value": {"0": 10.0, "1": 20.0},
        }
        rows = _parse_eurostat_json(payload)
        self.assertEqual(len(rows), 2)
        hs_codes = {r["hs_code"] for r in rows}
        self.assertEqual(hs_codes, {"2709", "2710"})
        crude = next(r for r in rows if r["hs_code"] == "2709")
        self.assertEqual(crude["hs_description"], "Crude oil")
        self.assertEqual(crude["year"], 2024)
        self.assertEqual(crude["reporter_iso2"], "DE")


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


class TestEurostatUpsertPath(unittest.TestCase):
    def test_upsert_calls_ingest_helpers(self) -> None:
        try:
            from backend.services import eurostat_trade as et  # type: ignore
        except ImportError:
            from services import eurostat_trade as et  # type: ignore

        fake_ingest = MagicMock()
        fake_ingest.ensure_table = MagicMock()
        fake_ingest.upsert_rows = MagicMock(return_value=1)
        modules = {
            "backend.ingest_oil_trades": fake_ingest,
            "ingest_oil_trades": fake_ingest,
        }
        conn = MagicMock()
        rows = [
            {
                "reporter": "Germany",
                "reporter_iso2": "DE",
                "partner": "Russia",
                "hs_code": "2709",
                "hs_description": "Crude oil",
                "flow_type": "M",
                "year": 2024,
                "trade_value_usd": 1000.0,
                "raw": {"dimensions": {"geo": "DE", "partner": "RU"}},
            }
        ]
        with mock.patch.dict(sys.modules, modules):
            count = et._upsert_oil_trade_flows(conn, rows)

        self.assertEqual(count, 1)
        fake_ingest.ensure_table.assert_called_once_with(conn)
        fake_ingest.upsert_rows.assert_called_once()
        ingest_rows = fake_ingest.upsert_rows.call_args[0][1]
        self.assertEqual(ingest_rows[0]["reporter_m49"], "DE")
        self.assertEqual(ingest_rows[0]["partner_m49"], "RU")
        self.assertEqual(ingest_rows[0]["hs_description"], "Crude oil")
        self.assertEqual(ingest_rows[0]["data_source"], "eurostat")


class TestOilTradeFlowsUniqueKey(unittest.TestCase):
    def test_upsert_sql_includes_data_source_in_conflict_target(self) -> None:
        from pathlib import Path

        ingest_py = Path(__file__).resolve().parents[1] / "ingest_oil_trades.py"
        source = ingest_py.read_text(encoding="utf-8")
        self.assertIn(
            "ON CONFLICT (reporter_m49, partner_m49, hs_code, flow_type, year, data_source)",
            source,
        )

    def test_graph_sync_applies_migration_018_when_constraint_missing(self) -> None:
        try:
            from backend.services import oil_live_graph_sync as gs  # type: ignore
        except ImportError:
            from services import oil_live_graph_sync as gs  # type: ignore

        conn = MagicMock()
        cur = MagicMock()
        cur.fetchone.side_effect = [
            (False,),  # port_calls.metadata exists → skip 011
            (True,),  # macro_source_unique missing → apply 018
        ]
        conn.cursor.return_value.__enter__ = MagicMock(return_value=cur)
        conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

        with mock.patch.object(gs, "_table_exists", return_value=True), mock.patch.object(
            gs, "_apply_migration_file"
        ) as apply_mock:
            gs.ensure_commercial_graph_tables(conn)

        apply_mock.assert_called_once_with(conn, gs._MIGRATION_018)


class TestEurostatIngestRow(unittest.TestCase):
    def test_dimensional_m49_codes(self) -> None:
        try:
            from backend.services.eurostat_trade import _to_ingest_row
        except ImportError:
            from services.eurostat_trade import _to_ingest_row  # type: ignore

        row = {
            "reporter": "European Union - 27 countries",
            "reporter_iso2": "EU",
            "partner": "Russia",
            "hs_code": "2709",
            "flow_type": "M",
            "year": 2023,
            "trade_value_usd": 100_000.0,
            "raw": {"dimensions": {"geo": "EU27_2020", "partner": "RU", "TIME_PERIOD": "2023"}},
        }
        ingest = _to_ingest_row(row)
        self.assertEqual(ingest["reporter_m49"], "EU27_2020")
        self.assertEqual(ingest["partner_m49"], "RU")
        self.assertEqual(ingest["data_source"], "eurostat")
        self.assertEqual(ingest["flow_type"], "M")

    def test_flat_fallback_partner_m49(self) -> None:
        try:
            from backend.services.eurostat_trade import _to_ingest_row
        except ImportError:
            from services.eurostat_trade import _to_ingest_row  # type: ignore

        ingest = _to_ingest_row(
            {
                "reporter": "European Union",
                "reporter_iso2": "EU",
                "partner": "Extra-EU",
                "hs_code": "2709",
                "flow_type": "M",
                "year": 2023,
                "trade_value_usd": 50_000.0,
                "raw": {},
            }
        )
        self.assertEqual(ingest["partner_m49"], "0")


if __name__ == "__main__":
    unittest.main()
