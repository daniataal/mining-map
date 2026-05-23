"""Tests for license ↔ stored macro trade linkage."""

from __future__ import annotations

import unittest

try:
    from backend.services.entity_trade_flows import query_stored_trade_flows
except ImportError:
    from services.entity_trade_flows import query_stored_trade_flows  # type: ignore


class TestQueryStoredTradeFlows(unittest.TestCase):
    def test_sql_matches_eurostat_partner_country(self) -> None:
        captured: list[str] = []

        class _Cur:
            def execute(self, sql: str, params: tuple) -> None:
                if "information_schema" not in sql:
                    captured.append(sql)

            def fetchone(self) -> tuple:
                return (False,)

            def fetchall(self) -> list:
                return []

            def __enter__(self) -> "_Cur":
                return self

            def __exit__(self, *args: object) -> None:
                return None

        class _Conn:
            def cursor(self) -> _Cur:
                return _Cur()

        query_stored_trade_flows(_Conn(), country="Russia", hs_codes=["2709"], limit=5)
        self.assertGreaterEqual(len(captured), 1)
        sql = captured[0].lower()
        self.assertIn("eurostat", sql)
        self.assertIn("partner", sql)

    def test_jodi_rows_mapped_to_macro_flows(self) -> None:
        try:
            from backend.services.entity_trade_flows import _jodi_rows_to_flow_dicts
        except ImportError:
            from services.entity_trade_flows import _jodi_rows_to_flow_dicts  # type: ignore

        rows = _jodi_rows_to_flow_dicts(
            [("Norway", "Crude oil", "Production", "2023-Q1", 1.5, None, "jodi", None)]
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["data_source"], "jodi")
        self.assertEqual(rows[0]["bol_tier"], "macro")
        self.assertEqual(rows[0]["year"], 2023)


class TestMacroSourceRecordUrl(unittest.TestCase):
    def test_eurostat_verify_url(self) -> None:
        try:
            from backend.services.entity_trade_flows import _macro_source_record_url
        except ImportError:
            from services.entity_trade_flows import _macro_source_record_url  # type: ignore

        url = _macro_source_record_url("eurostat")
        self.assertIsNotNone(url)
        self.assertIn("eurostat", url or "")
        self.assertIn("databrowser", url or "")

    def test_enrich_eurostat_flow(self) -> None:
        try:
            from backend.services.entity_trade_flows import _enrich_flow_item, _flow_for_api
        except ImportError:
            from services.entity_trade_flows import _enrich_flow_item, _flow_for_api  # type: ignore

        item = _enrich_flow_item(
            {
                "reporter": "Germany",
                "partner": "Russia",
                "data_source": "eurostat",
                "year": 2022,
                "raw": {"eurostat_key": "0", "dimensions": {"geo": ["DE"]}},
            }
        )
        self.assertEqual(item["bol_tier"], "macro")
        self.assertIn("eurostat", item["source_record_url"] or "")
        api = _flow_for_api(item)
        self.assertIn("sourceRecordUrl", api)
        self.assertEqual(api.get("raw"), {"eurostat_key": "0", "dimensions": {"geo": ["DE"]}})

    def test_oil_flows_list_shape_snake_case(self) -> None:
        """GET /api/oil/flows uses _enrich_flow_item (snake_case), not dossier camelCase."""
        try:
            from backend.services.entity_trade_flows import _enrich_flow_item
        except ImportError:
            from services.entity_trade_flows import _enrich_flow_item  # type: ignore

        item = _enrich_flow_item(
            {
                "reporter": "Germany",
                "data_source": "eurostat",
                "year": 2022,
                "raw": {"stored": True},
            }
        )
        self.assertIn("source_record_url", item)
        self.assertNotIn("sourceRecordUrl", item)
        self.assertEqual(item.get("bol_tier"), "macro")
        self.assertEqual(item.get("raw"), {"stored": True})


if __name__ == "__main__":
    unittest.main()
