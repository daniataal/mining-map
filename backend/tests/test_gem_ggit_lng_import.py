import json
import unittest
from pathlib import Path

from backend.services.ingest import gem_ggit_lng_terminals_import as mod

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "gem_ggit" / "sample_terminal.json"


class GemGgitLngImportTests(unittest.TestCase):
    def test_normalize_lng_terminal_row(self):
        row = json.loads(FIXTURE.read_text(encoding="utf-8"))
        out = mod.normalize_lng_terminal_row(row, sheet_name="LNG Terminals")
        self.assertIsNotNone(out)
        assert out is not None
        tags = out["tags"]
        self.assertEqual(tags["gem_location_id"], "LNG9999TEST")
        self.assertEqual(tags["terminal_type"], "import")
        self.assertEqual(tags["primary_counterparty"], "Example LNG Operator LLC")
        self.assertAlmostEqual(tags["capacity_mtpa"], 9.5)

    def test_normalize_missing_coords(self):
        row = json.loads(FIXTURE.read_text(encoding="utf-8"))
        row["Latitude"] = None
        self.assertIsNone(mod.normalize_lng_terminal_row(row))


if __name__ == "__main__":
    unittest.main()
