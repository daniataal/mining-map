import unittest
from unittest.mock import MagicMock

_IMPORT_ERROR = None
try:
    from backend.main import (
        _build_geo_cache_query_key,
        _load_cached_geo_fallbacks,
    )
except ModuleNotFoundError as exc:
    if exc.name == "psycopg2":
        _IMPORT_ERROR = exc
        _build_geo_cache_query_key = None
        _load_cached_geo_fallbacks = None
    else:
        raise
except ImportError as exc:
    _IMPORT_ERROR = exc
    _build_geo_cache_query_key = None
    _load_cached_geo_fallbacks = None


class TestGeoCache(unittest.TestCase):
    def setUp(self):
        if _IMPORT_ERROR is not None:
            self.skipTest(f"backend.main import unavailable: {_IMPORT_ERROR}")

    def test_build_query_key_region_and_country(self):
        key = _build_geo_cache_query_key("Ghana", "Ashanti Region\nKumasi")
        self.assertEqual(key, "ashanti region, ghana")

    def test_build_query_key_empty_returns_none(self):
        self.assertIsNone(_build_geo_cache_query_key(None, None))
        self.assertIsNone(_build_geo_cache_query_key("", ""))

    def test_load_cached_geo_fallbacks_selects_display_name(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [
            {
                "query_key": "ashanti region, ghana",
                "lat": 6.7,
                "lng": -1.6,
                "confidence": 0.9,
                "source": "nominatim",
                "display_name": "Ashanti Region, Ghana",
            }
        ]
        rows = [{"country": "Ghana", "region": "Ashanti Region", "lat": 0.0, "lng": 0.0}]

        cached = _load_cached_geo_fallbacks(cursor, rows)

        geo_sql = [
            call[0][0]
            for call in cursor.execute.call_args_list
            if "FROM geo_cache" in call[0][0]
        ]
        self.assertEqual(len(geo_sql), 1)
        self.assertIn("display_name", geo_sql[0])
        self.assertEqual(cached["ashanti region, ghana"]["display_name"], "Ashanti Region, Ghana")

    def test_load_cached_geo_fallbacks_releases_savepoint_on_success(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        rows = [{"country": "Ghana", "region": "Ashanti", "lat": 0.0, "lng": 0.0}]

        _load_cached_geo_fallbacks(cursor, rows)

        executed = [call[0][0] for call in cursor.execute.call_args_list]
        self.assertIn("SAVEPOINT geo_cache_lookup", executed)
        self.assertIn("RELEASE SAVEPOINT geo_cache_lookup", executed)

    def test_load_cached_geo_fallbacks_rolls_back_savepoint_on_error(self):
        cursor = MagicMock()

        def _execute(sql, *_args, **_kwargs):
            if "FROM geo_cache" in sql:
                raise Exception('column "display_name" does not exist')

        cursor.execute.side_effect = _execute
        rows = [{"country": "Ghana", "region": "Ashanti", "lat": 0.0, "lng": 0.0}]

        cached = _load_cached_geo_fallbacks(cursor, rows)

        self.assertEqual(cached, {})
        executed = [call[0][0] for call in cursor.execute.call_args_list]
        self.assertIn("ROLLBACK TO SAVEPOINT geo_cache_lookup", executed)


if __name__ == "__main__":
    unittest.main()
