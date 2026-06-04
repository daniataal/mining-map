import json
import unittest
from pathlib import Path

from backend.services.ingest import gem_gogpt_plants_import as mod

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "gem_gogpt" / "sample_unit.json"


class GemGogptPlantsImportTests(unittest.TestCase):
    def test_normalize_plant_row_counterparties(self):
        row = json.loads(FIXTURE.read_text(encoding="utf-8"))
        out = mod.normalize_plant_row(row)
        self.assertIsNotNone(out)
        assert out is not None
        tags = out["tags"]
        self.assertEqual(tags["gem_unit_id"], "G9999TEST")
        self.assertEqual(tags["primary_counterparty"], "Example Operator LLC")
        self.assertIn("Example Owner Inc", tags["owners"])
        self.assertEqual(tags["captive_industry_type"], "chemicals")
        parties = tags["counterparties"]
        roles = {p["role"] for p in parties}
        self.assertIn("operator", roles)
        self.assertIn("owner", roles)
        self.assertIn("captive_demand", roles)

    def test_normalize_plant_row_missing_coords(self):
        row = json.loads(FIXTURE.read_text(encoding="utf-8"))
        row["Latitude"] = None
        self.assertIsNone(mod.normalize_plant_row(row))

    def test_split_party_list(self):
        names = mod._split_party_list("Alpha; Beta & Gamma")
        self.assertEqual(names, ["Alpha", "Beta", "Gamma"])


if __name__ == "__main__":
    unittest.main()
