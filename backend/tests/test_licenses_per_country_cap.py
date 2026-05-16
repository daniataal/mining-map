import unittest
from unittest.mock import MagicMock

try:
    from backend.main import _fetch_license_rows_for_api
except ImportError:
    from main import _fetch_license_rows_for_api


class TestLicensesPerCountryCap(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
