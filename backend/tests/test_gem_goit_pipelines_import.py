"""Tests for GEM GOIT pipeline ingest helpers."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from backend.services.ingest import gem_goit_pipelines_import as mod

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "gem_goit"


class GemGoitPipelinesImportTests(unittest.TestCase):
    def test_classify_fuel_group(self):
        self.assertEqual(mod.classify_fuel_group("Oil"), "oil")
        self.assertEqual(mod.classify_fuel_group("NGL"), "ngl")
        self.assertEqual(mod.classify_fuel_group("Oil, NGL"), "ngl")
        self.assertEqual(mod.classify_fuel_group(""), "other")

    def test_normalize_row_tags(self):
        row = {
            "ProjectID": "P0001",
            "PipelineName": "Test Pipeline",
            "SegmentName": "Segment A",
            "Fuel": "Oil",
            "Status": "operating",
            "Capacity": "100,000.00",
            "CapacityUnits": "bpd",
            "LengthMergedKm": 100,
            "Wiki": "https://www.gem.wiki/Test",
        }
        row["StartLocation"] = "Point A"
        row["EndLocation"] = "Point B"
        tags = mod.normalize_row_tags(row, 2)
        self.assertIsNotNone(tags)
        assert tags is not None
        self.assertEqual(tags["project_id"], "P0001")
        self.assertEqual(tags["fuel_group"], "oil")
        self.assertIn("bpd", tags["capacity_text"] or "")
        self.assertEqual(tags["status"], "operating")
        self.assertEqual(tags["start_location"], "Point A")
        self.assertEqual(tags["end_location"], "Point B")

    def test_extract_geometries_linestring(self):
        payload = json.loads((FIXTURES / "P0001.geojson").read_text())
        geoms = mod._extract_geometries(payload)
        self.assertEqual(len(geoms), 1)
        self.assertEqual(geoms[0]["type"], "LineString")

    def test_load_project_geometry(self):
        geom = mod._load_project_geometry(FIXTURES, "P0001")
        self.assertIsNotNone(geom)
        self.assertIn(geom["type"], ("LineString", "MultiLineString"))

    def test_load_project_geometry_missing(self):
        self.assertIsNone(mod._load_project_geometry(FIXTURES, "P9999"))


if __name__ == "__main__":
    unittest.main()
