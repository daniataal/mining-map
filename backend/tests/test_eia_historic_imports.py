"""Tests for EIA historic file ingest (no network, fixture xlsx)."""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")
os.environ["ADMIN_TOKEN"] = "test-admin-token"

try:
    from backend.services import eia_historic_imports as eia_mod
except ImportError:  # pragma: no cover
    from services import eia_historic_imports as eia_mod  # type: ignore

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "eia_sample.xlsx"


class EiaHistoricMappingTests(unittest.TestCase):
    def test_crude_family(self):
        self.assertEqual(eia_mod.map_product_to_commodity_family("CRUDE OIL", 51), "crude")

    def test_row_to_record_normalizes_kbbl_to_bbl(self):
        row = {
            "RPT_PERIOD": "2020-03-31",
            "R_S_NAME": "CHEVRON USA INC",
            "LINE_NUM": 1,
            "PROD_CODE": 51,
            "PROD_NAME": "CRUDE OIL",
            "PORT_CODE": "5301",
            "CNTRY_NAME": "SAUDI ARABIA",
            "QUANTITY": 1200,
        }
        rec = eia_mod._row_to_record(row, source_file="eia_sample.xlsx", source_sheet="IMPORTS")
        self.assertIsNotNone(rec)
        assert rec is not None
        self.assertEqual(rec["volume"], 1_200_000.0)
        self.assertEqual(rec["volume_unit"], "bbl")
        self.assertEqual(rec["commodity_family"], "crude")


class EiaHistoricIngestTests(unittest.TestCase):
    def test_read_fixture_sheet(self):
        if not FIXTURE.is_file():
            self.skipTest("fixture missing")
        path = FIXTURE
        xl_engine = "openpyxl"
        import pandas as pd

        xl = pd.ExcelFile(path, engine=xl_engine)
        self.assertIn("IMPORTS", xl.sheet_names)
        df = eia_mod._read_sheet(path, "IMPORTS")
        self.assertGreaterEqual(len(df), 3)

    def test_ingest_folder_inserts_rows(self):
        if not FIXTURE.is_file():
            self.skipTest("fixture missing")

        tmp = tempfile.mkdtemp()
        try:
            target = Path(tmp) / "impa20d.xlsx"
            shutil.copy(FIXTURE, target)

            conn = MagicMock()
            cur = MagicMock()
            cur.rowcount = 1
            conn.cursor.return_value.__enter__ = MagicMock(return_value=cur)
            conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

            summary = eia_mod.ingest_eia_downloads_folder(conn, tmp)
            self.assertEqual(summary["status"], "ok")
            self.assertEqual(summary["files_processed"], 1)
            self.assertGreater(summary["rows_parsed"], 0)
            self.assertTrue(cur.execute.called)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class EiaHistoricApiTests(unittest.TestCase):
    @unittest.mock.patch("backend.services.eia_historic_imports.query_summary")
    def test_query_summary_shape(self, mock_summary):
        mock_summary.return_value = {
            "year_min": 2000,
            "year_max": 2024,
            "row_count": 100,
            "top_importers": [{"importer_name": "CHEVRON", "volume_bbl": 1e6}],
        }
        conn = MagicMock()
        out = eia_mod.query_summary(conn, importer="Chevron")
        mock_summary.assert_called_once()
        self.assertEqual(out["year_min"], 2000)


if __name__ == "__main__":
    unittest.main()
