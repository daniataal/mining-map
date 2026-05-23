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


if __name__ == "__main__":
    unittest.main()
