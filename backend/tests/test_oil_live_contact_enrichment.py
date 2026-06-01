"""Tests for oil-live contact enrichment batch helpers."""

import unittest


class TestOilLiveContactEnrichment(unittest.TestCase):
    def test_limit_clamped_in_query_range(self):
        from backend.services.oil_live_contact_enrichment import run_oil_live_contact_enrichment_batch

        class FakeCursor:
            def execute(self, *_args, **_kwargs):
                pass

            def fetchall(self):
                return []

            def close(self):
                pass

        class FakeConn:
            def cursor(self):
                return FakeCursor()

        result = run_oil_live_contact_enrichment_batch(FakeConn(), limit=500)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["requested_limit"], 100)


if __name__ == "__main__":
    unittest.main()
