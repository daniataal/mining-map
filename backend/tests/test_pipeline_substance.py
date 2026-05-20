"""Tests for OSM pipeline substance classification."""

from __future__ import annotations

import unittest

from backend.services.pipeline_substance import classify_pipeline_substance


class PipelineSubstanceTests(unittest.TestCase):
    def test_substance_tag_oil(self):
        self.assertEqual(classify_pipeline_substance({"substance": "oil"}), "oil")

    def test_substance_tag_water(self):
        self.assertEqual(classify_pipeline_substance({"substance": "water"}), "water")

    def test_qatar_water_project_arabic_name(self):
        """OSM way 296661798 — no substance tag; name implies water."""
        tags = {
            "man_made": "pipeline",
            "name": "مشروع المياه القطري",
            "name:ar": "مشروع المياه القطري",
            "name:en": "HaMovil HaArtsi",
        }
        self.assertEqual(classify_pipeline_substance(tags), "water")

    def test_unknown_untagged_pipeline(self):
        self.assertEqual(
            classify_pipeline_substance({"man_made": "pipeline"}),
            "unknown",
        )


if __name__ == "__main__":
    unittest.main()
