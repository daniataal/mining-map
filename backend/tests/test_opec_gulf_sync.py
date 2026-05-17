import unittest
from unittest import mock

from backend.services.ingest import opec_gulf_sync as sync


class _FakeCursor:
    def __init__(self):
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params):
        self.calls.append((sql, params))


class _FakeConn:
    def __init__(self):
        self.cursor_obj = _FakeCursor()
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class OpecGulfSyncTests(unittest.TestCase):
    def test_seed_uses_schema_backed_trust_and_entity_fields(self):
        conn = _FakeConn()
        entity = sync.GulfOilEntity(
            "Test National Oil Co",
            "Testland",
            "Main Basin",
            10.0,
            20.0,
            "Crude Oil",
            "National Oil Company",
            "Active",
            "https://example.test",
        )

        with mock.patch.object(sync, "GULF_OIL_ENTITIES", [entity]):
            written = sync.seed_gulf_oil_entities(conn, {"Testland": 1234.0})

        self.assertEqual(written, 1)
        self.assertEqual(conn.commits, 1)
        self.assertEqual(conn.rollbacks, 0)
        sql, params = conn.cursor_obj.calls[0]
        self.assertIn("record_origin", sql)
        self.assertIn("source_kind", sql)
        self.assertIn("entity_subtype", sql)
        self.assertIn("confidence_score", sql)
        self.assertIn("ON CONFLICT (external_id)", sql)
        self.assertNotIn("gen_random_uuid", sql)
        self.assertIn("global_open_fallback", params)
        self.assertIn("opec_gulf_reference", params)
        self.assertTrue(
            any("Curated OPEC/Persian Gulf reference row" in str(param) for param in params)
        )


if __name__ == "__main__":
    unittest.main()
