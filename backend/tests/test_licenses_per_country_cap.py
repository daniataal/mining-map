import unittest
from unittest.mock import MagicMock

_IMPORT_ERROR = None
try:
    from backend.main import _build_license_api_results, _fetch_license_rows_for_api
except ModuleNotFoundError as exc:
    if exc.name == "psycopg2":
        _IMPORT_ERROR = exc
        _build_license_api_results = None
        _fetch_license_rows_for_api = None
    else:
        try:
            from main import _build_license_api_results, _fetch_license_rows_for_api
        except ImportError as fallback_exc:
            _IMPORT_ERROR = fallback_exc
            _build_license_api_results = None
            _fetch_license_rows_for_api = None
except ImportError as exc:
    _IMPORT_ERROR = exc
    _build_license_api_results = None
    _fetch_license_rows_for_api = None


class TestLicensesPerCountryCap(unittest.TestCase):
    def setUp(self):
        if _IMPORT_ERROR is not None:
            self.skipTest(f"backend.main import unavailable: {_IMPORT_ERROR}")

    def test_multi_country_query_uses_row_number_cap(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = []

        _fetch_license_rows_for_api(
            cursor,
            "mining",
            country_filters=["Ghana", "South Africa", "Global"],
            limit=10000,
        )

        sql = cursor.execute.call_args[0][0]
        params = cursor.execute.call_args[0][1]
        self.assertIn("ROW_NUMBER() OVER (PARTITION BY country", sql)
        self.assertIn("ranked.rn <= %s", sql)
        self.assertIn("LOWER(TRIM(COALESCE(NULLIF(TRIM(sector), ''), 'mining'))) = %s", sql)
        self.assertEqual(params[0], "mining")
        self.assertEqual(params[-1], 10000)

    def test_single_country_query_uses_simple_limit(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = []

        _fetch_license_rows_for_api(
            cursor,
            "mining",
            country_filters=["Ghana"],
            limit=5000,
        )

        sql = cursor.execute.call_args[0][0]
        params = cursor.execute.call_args[0][1]
        self.assertNotIn("ROW_NUMBER()", sql)
        self.assertIn("LIMIT %s", sql)
        self.assertEqual(params[-1], 5000)

    def test_license_api_result_exposes_trust_and_entity_metadata(self):
        rows = [
            {
                "id": "lic-1",
                "company": "Trust Metals",
                "license_type": "Mining Lease",
                "commodity": "Copper",
                "status": "Active",
                "date_issued": None,
                "country": "Ghana",
                "region": "Ashanti",
                "sector": "mining",
                "lat": 6.1,
                "lng": -1.3,
                "phone_number": None,
                "contact_person": None,
                "record_origin": "open_data",
                "source_id": "ghana_minerals_commission",
                "source_name": "Ghana Minerals Commission",
                "source_url": None,
                "source_record_url": "https://example.test/lic-1",
                "source_updated_at": None,
                "last_synced_at": "2026-05-01T00:00:00Z",
                "source_kind": "official_registry",
                "entity_kind": "license",
                "entity_subtype": "mining_license",
                "confidence_score": 0.91,
                "confidence_note": "Official registry row.",
                "geo_source": "user",
                "geo_approximated": False,
                "geo_confidence": 1.0,
                "original_lat": 6.1,
                "original_lng": -1.3,
            }
        ]

        def describe(_source_id, _origin, *, registry=None):
            return {
                "source_kind": "official_registry",
                "source_access": "open_machine_readable",
                "coverage_state": "official_syncable",
                "provenance_note": "Official source.",
            }

        results = _build_license_api_results(rows, {}, describe, {})

        self.assertEqual(results[0]["sourceKind"], "official_registry")
        self.assertEqual(results[0]["sourceAccess"], "open_machine_readable")
        self.assertEqual(results[0]["coverageState"], "official_syncable")
        self.assertEqual(results[0]["entityKind"], "license")
        self.assertEqual(results[0]["entitySubtype"], "mining_license")
        self.assertEqual(results[0]["confidenceScore"], 0.91)
        self.assertEqual(results[0]["confidenceNote"], "Official registry row.")


if __name__ == "__main__":
    unittest.main()
