import unittest
from unittest import mock
from urllib.error import HTTPError

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
            notes="World's largest oil producer by output.",
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
        self.assertIn("raw_payload", sql)
        self.assertIn("confidence_score", sql)
        self.assertIn('{"notes": "World\'s largest oil producer by output."}', params)
        self.assertIn("ON CONFLICT (external_id)", sql)
        self.assertNotIn("gen_random_uuid", sql)
        self.assertIn("global_open_fallback", params)
        self.assertIn("opec_gulf_reference", params)
        self.assertTrue(
            any("Curated OPEC/Persian Gulf reference row" in str(param) for param in params)
        )

    def test_resolve_entity_subtype_marks_refineries(self):
        entity = sync.GulfOilEntity(
            "Test Refinery",
            "Testland",
            "Coast",
            1.0,
            2.0,
            "Refined Products",
            "Refinery Complex",
            "Active",
        )
        self.assertEqual(sync._resolve_entity_subtype(entity), "refinery")

    def test_sector_for_mining_subtype_is_mining(self):
        entity = sync.GulfOilEntity(
            "Example Mining Co",
            "Testland",
            "Capital",
            1.0,
            2.0,
            "Gold / Phosphate",
            "Mining Conglomerate",
            "Active",
            entity_subtype="mining",
        )
        self.assertEqual(sync._sector_for_entity(entity), "mining")

    def test_gulf_reference_excludes_mining_conglomerates(self):
        names = {e.company for e in sync.GULF_OIL_ENTITIES}
        self.assertNotIn("Ma'aden Mining Company", names)
        self.assertNotIn("Emirates Steel / EMIRATES GLOBAL ALUMINIUM", names)

    def test_eia_production_url_uses_v2_international_facets(self):
        url = sync._eia_production_url("SAU", api_key="test-key")
        self.assertIn("countryRegionId", url)
        self.assertNotIn("countryRegionCode", url)
        self.assertIn("facets%5BproductId%5D%5B%5D=5", url)
        self.assertIn("facets%5BactivityId%5D%5B%5D=1", url)
        self.assertNotIn("test-key", sync._redact_api_key(url))

    def test_fetch_eia_production_parses_latest_value(self):
        payload = {"response": {"data": [{"value": "1234.5", "period": "2024-01"}]}}
        with mock.patch.object(sync, "EIA_API_KEY", "secret"):
            with mock.patch.object(sync, "_get", return_value=payload):
                self.assertEqual(sync.fetch_eia_production("SAU"), 1234.5)

    def test_eia_http_400_logs_once(self):
        sync._EIA_HTTP_WARNED.clear()
        err = HTTPError(
            url="http://example",
            code=400,
            msg="Bad Request",
            hdrs=None,
            fp=None,
        )
        with mock.patch.object(sync, "urlopen", side_effect=err):
            with mock.patch("builtins.print") as printed:
                sync._get("https://api.eia.gov/v2/international/data/?api_key=secret", context="a")
                sync._get("https://api.eia.gov/v2/international/data/?api_key=secret", context="b")
        eia_400_msgs = [
            c
            for c in printed.call_args_list
            if c.args and "HTTP 400" in str(c.args[0])
        ]
        self.assertEqual(len(eia_400_msgs), 1)
        logged = str(eia_400_msgs[0].args[0])
        self.assertNotIn("secret", logged)


if __name__ == "__main__":
    unittest.main()
