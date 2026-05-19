import os
import unittest

from backend.services.petroleum_osm_store import ensure_petroleum_osm_tables


class PetroleumOsmStoreTests(unittest.TestCase):
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
