"""Tests for GEM Global Oil and Gas Extraction Tracker ingest."""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

try:
    from backend.services.ingest import gem_extraction_tracker_import as gem_mod
except ImportError:  # pragma: no cover
    from services.ingest import gem_extraction_tracker_import as gem_mod  # type: ignore


class GemNormalizeTests(unittest.TestCase):
    def test_normalize_row_maps_core_fields(self):
        row = {
            "Unit ID": "L100000321006",
            "Unit Name": "Athabasca Oil Asset",
            "Fuel type": "oil",
            "Country/Area": "Canada",
            "Subnational unit": "Alberta",
            "Production Type": "unconventional",
            "Status": "operating",
            "Operator": "Canadian Natural Resources",
            "Latitude": "56.7",
            "Longitude": "-111.4",
            "Onshore/Offshore": "onshore",
            "Wiki URL (field)": "https://www.gem.wiki/example",
        }
        record = gem_mod.normalize_gem_field_row(row)
        self.assertIsNotNone(record)
        assert record is not None
        self.assertEqual(record["id"], "gem_global_extraction_tracker_march_2026:L100000321006")
        self.assertEqual(record["sector"], "oil_and_gas")
        self.assertEqual(record["record_origin"], "global_open_fallback")
        self.assertEqual(record["source_id"], gem_mod.SOURCE_ID)
        self.assertEqual(record["company"], "Canadian Natural Resources")
        self.assertEqual(record["country"], "Canada")
        self.assertEqual(record["lat"], 56.7)
        self.assertEqual(record["lng"], -111.4)
        self.assertIn("unconventional", record["license_type"])
        self.assertEqual(record["source_record_url"], "https://www.gem.wiki/example")

    def test_skips_rows_without_unit_or_country(self):
        self.assertIsNone(gem_mod.normalize_gem_field_row({"Unit ID": "X"}))
        self.assertIsNone(gem_mod.normalize_gem_field_row({"Country/Area": "Norway"}))

    def test_merges_reserves_into_raw_payload(self):
        row = {
            "Unit ID": "U1",
            "Unit Name": "Test Field",
            "Country/Area": "Norway",
            "Fuel type": "gas",
            "Status": "operating",
        }
        reserves = {"Unit ID": "U1", "Reserves (oil, million bbl)": "100"}
        record = gem_mod.normalize_gem_field_row(row, reserves=reserves)
        self.assertIsNotNone(record)
        assert record is not None
        payload = json.loads(record["raw_payload"])
        self.assertIn("reserves", payload)
        self.assertEqual(payload["reserves"]["Unit ID"], "U1")

    def test_invalid_coordinates_are_dropped(self):
        row = {
            "Unit ID": "U2",
            "Unit Name": "Bad Coords",
            "Country/Area": "Iraq",
            "Latitude": "999",
            "Longitude": "0",
        }
        record = gem_mod.normalize_gem_field_row(row)
        self.assertIsNotNone(record)
        assert record is not None
        self.assertIsNone(record["lat"])
        self.assertIsNone(record["lng"])


class GemIngestTests(unittest.TestCase):
    def test_ingest_skips_missing_workbook(self):
        conn = MagicMock()
        summary = gem_mod.ingest_gem_extraction_tracker(
            conn, workbook_path="/tmp/does-not-exist-gem-tracker.xlsx"
        )
        self.assertEqual(summary["status"], "skipped")
        conn.cursor.assert_not_called()

    @patch.object(Path, "is_file", return_value=True)
    @patch.object(gem_mod, "iter_gem_field_records")
    @patch.object(gem_mod, "upsert_open_data_records")
    def test_ingest_upserts_parsed_rows(self, upsert_mock, iter_mock, _is_file_mock):
        iter_mock.return_value = [
            {
                "id": "gem_global_extraction_tracker_march_2026:U1",
                "company": "Operator A",
                "country": "Norway",
                "region": "",
                "commodity": "Gas",
                "license_type": "conventional",
                "status": "operating",
                "lat": 60.0,
                "lng": 5.0,
                "date_issued": None,
                "sector": "oil_and_gas",
                "record_origin": "global_open_fallback",
                "source_id": gem_mod.SOURCE_ID,
                "source_name": gem_mod.SOURCE_NAME,
                "source_url": gem_mod.SOURCE_URL,
                "source_record_url": None,
                "source_updated_at": "2026-03-01",
                "raw_payload": "{}",
            }
        ]
        upsert_mock.return_value = 1
        conn = MagicMock()
        summary = gem_mod.ingest_gem_extraction_tracker(conn, workbook_path="fake.xlsx")
        self.assertEqual(summary["status"], "ok")
        self.assertEqual(summary["rows_upserted"], 1)
        upsert_mock.assert_called_once()

    def test_auto_ingest_disabled(self):
        conn = MagicMock()
        with patch.dict(os.environ, {"GEM_TRACKER_AUTO_INGEST": "false"}, clear=False):
            out = gem_mod.try_auto_ingest_gem_tracker(conn)
        self.assertEqual(out["status"], "skipped")
        self.assertIn("AUTO_INGEST", out.get("reason", ""))


if __name__ == "__main__":
    unittest.main()
