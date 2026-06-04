import unittest
from unittest.mock import MagicMock, patch

from backend.services.infrastructure_coverage import (
    LIMITATIONS,
    build_infrastructure_coverage,
    nearest_gem_pipeline_segment,
)


class InfrastructureCoverageTests(unittest.TestCase):
    def test_limitations_non_empty(self):
        self.assertGreater(len(LIMITATIONS), 2)

    @patch("backend.services.infrastructure_coverage.build_gem_osm_pipeline_coverage")
    @patch("backend.services.infrastructure_coverage.layer_feature_stats")
    @patch("backend.services.infrastructure_coverage.segment_stats")
    @patch("backend.services.infrastructure_coverage.terminal_stats")
    @patch("backend.services.infrastructure_coverage.plant_stats")
    def test_build_without_bbox(self, mock_plant, mock_lng, mock_seg, mock_osm, mock_pipe_cmp):
        mock_seg.return_value = {"feature_count": 10}
        mock_plant.return_value = {"feature_count": 5}
        mock_lng.return_value = {"feature_count": 2}
        mock_osm.return_value = {"feature_count": 100}
        conn = MagicMock()
        out = build_infrastructure_coverage(conn, bbox=None)
        self.assertIn("note", out)
        self.assertEqual(out["global"]["gem_pipelines"], 10)

    def test_nearest_none_when_empty(self):
        conn = MagicMock()
        cur = MagicMock()
        cur.fetchone.return_value = None
        conn.cursor.return_value.__enter__ = MagicMock(return_value=cur)
        conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        with patch(
            "backend.services.infrastructure_coverage.ensure_gem_pipeline_tables",
            return_value=None,
        ):
            hit = nearest_gem_pipeline_segment(conn, lat=25.0, lng=56.0)
        self.assertIsNone(hit)


if __name__ == "__main__":
    unittest.main()
