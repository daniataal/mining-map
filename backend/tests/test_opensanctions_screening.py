"""Mocked tests for OpenSanctions screening service (no network)."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

try:
    from backend.services import opensanctions_screening as os_mod
except ImportError:  # pragma: no cover
    from services import opensanctions_screening as os_mod  # type: ignore


class _FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = ""

    def json(self):
        return self._payload


class ScreenCompanyTests(unittest.TestCase):
    def test_high_score_flags(self):
        payload = {
            "results": [
                {
                    "id": "ent-1",
                    "caption": "ACME SANCTIONED CORP",
                    "schema": "Company",
                    "score": 0.92,
                    "datasets": ["sanctions"],
                    "properties": {"country": ["RU"], "topics": ["sanction"]},
                }
            ]
        }
        with patch.object(os_mod, "requests") as mock_requests:
            mock_requests.get.return_value = _FakeResponse(200, payload)
            out = os_mod.screen_company("ACME SANCTIONED CORP")
        self.assertEqual(out["status"], "flagged")
        self.assertEqual(len(out["matches"]), 1)
        self.assertEqual(out["matches"][0]["id"], "ent-1")
        self.assertEqual(out["matches"][0]["countries"], ["RU"])

    def test_medium_score_review(self):
        payload = {
            "results": [
                {
                    "id": "ent-2",
                    "caption": "ACME TRADING",
                    "score": 0.6,
                    "properties": {},
                }
            ]
        }
        with patch.object(os_mod, "requests") as mock_requests:
            mock_requests.get.return_value = _FakeResponse(200, payload)
            out = os_mod.screen_company("ACME TRADING")
        self.assertEqual(out["status"], "review")

    def test_no_hits_clear(self):
        with patch.object(os_mod, "requests") as mock_requests:
            mock_requests.get.return_value = _FakeResponse(200, {"results": []})
            out = os_mod.screen_company("Some Local Mom-and-pop LLC")
        self.assertEqual(out["status"], "clear")
        self.assertEqual(out["matches"], [])

    def test_http_429_unknown(self):
        with patch.object(os_mod, "requests") as mock_requests:
            mock_requests.get.return_value = _FakeResponse(429, {})
            out = os_mod.screen_company("Anyone")
        self.assertEqual(out["status"], "unknown")
        self.assertEqual(out["status_code"], 429)

    def test_http_500_unknown(self):
        with patch.object(os_mod, "requests") as mock_requests:
            mock_requests.get.return_value = _FakeResponse(503, {})
            out = os_mod.screen_company("Anyone")
        self.assertEqual(out["status"], "unknown")

    def test_network_error_unknown(self):
        with patch.object(os_mod, "requests") as mock_requests:
            mock_requests.get.side_effect = RuntimeError("boom")
            out = os_mod.screen_company("Anyone")
        self.assertEqual(out["status"], "unknown")
        self.assertIn("boom", out.get("message", ""))

    def test_empty_name(self):
        out = os_mod.screen_company("   ")
        self.assertEqual(out["status"], "unknown")


class BatchScreenerTests(unittest.TestCase):
    def _mock_conn(
        self,
        *,
        has_columns: bool = True,
        rows: list[tuple[str, str]] | None = None,
    ):
        conn = MagicMock()
        cur = MagicMock()
        cur.__enter__.return_value = cur
        cur.__exit__.return_value = False
        conn.cursor.return_value = cur

        sentinel_present = object() if has_columns else None
        cur.fetchone.return_value = (sentinel_present,) if has_columns else None
        cur.fetchall.return_value = rows or []
        return conn, cur

    def test_skip_when_columns_missing(self):
        conn, _ = self._mock_conn(has_columns=False)
        out = os_mod.screen_companies_for_sanctions(conn, limit=10, throttle_seconds=0)
        self.assertEqual(out["status"], "skipped")
        self.assertTrue(out["skipped_missing_columns"])

    def test_batch_updates_rows(self):
        rows = [("id-1", "ACME SANCTIONED CORP"), ("id-2", "MOM AND POP LLC")]
        conn, cur = self._mock_conn(has_columns=True, rows=rows)

        with patch.object(
            os_mod,
            "screen_company",
            side_effect=[
                {"status": "flagged", "matches": [{"id": "x", "score": 0.95}]},
                {"status": "clear", "matches": []},
            ],
        ):
            out = os_mod.screen_companies_for_sanctions(
                conn, limit=10, throttle_seconds=0
            )

        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["checked"], 2)
        self.assertEqual(out["flagged"], 1)
        self.assertEqual(out["clear"], 1)
        # Two UPDATEs expected (one per row).
        update_calls = [
            c
            for c in cur.execute.call_args_list
            if "UPDATE oil_companies" in str(c.args[0])
        ]
        self.assertGreaterEqual(len(update_calls), 2)


if __name__ == "__main__":
    unittest.main()
