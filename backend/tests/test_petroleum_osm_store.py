import os
import unittest
from unittest.mock import patch

from backend.services.petroleum_osm_store import ensure_petroleum_osm_tables, get_layer_geojson_from_db


class FakeCursor:
    def __init__(self):
        self.executed = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchall(self):
        return [("node", 123, {"name": "Test refinery"}, {"type": "Point", "coordinates": [0, 0]})]

    def fetchone(self):
        return (1, None)


class FakeConn:
    def __init__(self):
        self.cursor_obj = FakeCursor()

    def cursor(self):
        return self.cursor_obj


class PetroleumOsmStoreTests(unittest.TestCase):
    def test_geojson_db_query_orders_simplify_param_before_where_params(self):
        conn = FakeConn()
        with patch("backend.services.license_map_perf.simplify_tolerance_for_zoom", return_value=0.25):
            get_layer_geojson_from_db(conn, "refineries", bbox=(-5, -10, 5, 10), zoom=3)

        select_calls = [
            call for call in conn.cursor_obj.executed if "SELECT osm_type, osm_id, tags" in call[0]
        ]
        self.assertEqual(len(select_calls), 1)
        self.assertEqual(select_calls[0][1], (0.25, "refineries", -10, -5, 10, 5, 50000))

    def test_pipeline_geojson_uses_zoom_limit_and_fast_simplify(self):
        conn = FakeConn()
        with patch("backend.services.license_map_perf.simplify_tolerance_for_zoom", return_value=0.25):
            with patch("backend.services.license_map_perf.pipeline_geojson_limit_for_zoom", return_value=2000):
                get_layer_geojson_from_db(conn, "pipelines", bbox=(-5, -10, 5, 10), zoom=6)

        select_calls = [
            call for call in conn.cursor_obj.executed if "SELECT osm_type, osm_id, tags" in call[0]
        ]
        self.assertEqual(len(select_calls), 1)
        sql = select_calls[0][0]
        self.assertIn("ST_Simplify(", sql)
        self.assertNotIn("SimplifyPreserveTopology", sql)
        self.assertIn("geom &&", sql)
        self.assertEqual(select_calls[0][1], (0.25, "pipelines", -10, -5, 10, 5, 2000))

    def test_ensure_table_idempotent(self):
        try:
            import psycopg2
        except ImportError:
            self.skipTest("psycopg2 not installed")
        try:
            conn = psycopg2.connect(
                host=os.getenv("DB_HOST", "localhost"),
                dbname=os.getenv("DB_NAME", "mining_db"),
                user=os.getenv("DB_USER", "postgres"),
                password=os.getenv("DB_PASSWORD", "password"),
            )
        except Exception as exc:
            self.skipTest(f"DB not available: {exc}")
        try:
            ensure_petroleum_osm_tables(conn)
            ensure_petroleum_osm_tables(conn)
            conn.commit()
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
