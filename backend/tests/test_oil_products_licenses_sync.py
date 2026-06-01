import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend.services.ingest import oil_products_licenses_sync as sync


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


class OilProductsLicensesSyncTests(unittest.TestCase):
    def test_normalize_commodity_canonicalizes_aliases(self):
        self.assertEqual(sync.normalize_commodity("diesel, gasoline"), "Diesel, Gasoline")
        self.assertEqual(sync.normalize_commodity("Maya crude"), "Maya Crude")
        self.assertEqual(sync.normalize_commodity("CRUDE OIL"), "Crude Oil")
        self.assertEqual(sync.normalize_commodity("petrol / LPG"), "Gasoline, LPG")
        self.assertEqual(sync.normalize_commodity(""), "Refined Products")

    def test_load_seed_entities_from_json(self):
        sample = {
            "entities": [
                {
                    "company": "Test Fuel Co",
                    "country": "Testland",
                    "region": "Capital",
                    "lat": 1.0,
                    "lng": 2.0,
                    "commodity": "diesel",
                    "license_type": "Fuel marketing",
                    "status": "Active",
                    "source_record_url": "https://example.test",
                }
            ]
        }
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            json.dump(sample, tmp)
            path = Path(tmp.name)

        entities = sync.load_seed_entities(path)
        self.assertEqual(len(entities), 1)
        self.assertEqual(entities[0].commodity, "Diesel")
        self.assertEqual(entities[0].entity_subtype, "fuel_marketer")

    def test_seed_uses_curated_reference_and_external_id_prefix(self):
        conn = _FakeConn()
        entity = sync.OilProductsLicenseEntity(
            company="Sample Marketer LLC",
            country="United States",
            region="Texas",
            lat=29.76,
            lng=-95.36,
            commodity="Gasoline, Diesel",
            license_type="Petroleum products marketing",
            status="Active",
            source_record_url="https://example.test",
        )

        written = sync.seed_oil_products_licenses(conn, [entity])
        self.assertEqual(written, 1)
        self.assertEqual(conn.commits, 1)
        sql, params = conn.cursor_obj.calls[0]
        self.assertIn("ON CONFLICT (external_id)", sql)
        self.assertIn("entity_subtype", sql)
        self.assertIn("curated_reference", params)
        self.assertIn("oil_and_gas", params)
        self.assertIn("fuel_marketer", params)
        self.assertTrue(any(str(p).startswith("oil_products_lic_") for p in params))

    def test_repo_seed_file_has_entities(self):
        entities = sync.load_seed_entities()
        self.assertGreaterEqual(len(entities), 20)
        for entity in entities:
            self.assertTrue(entity.company)
            self.assertTrue(entity.country)
            self.assertEqual(entity.entity_subtype, "fuel_marketer")


if __name__ == "__main__":
    unittest.main()
