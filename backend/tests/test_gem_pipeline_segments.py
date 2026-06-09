"""Tests for GEM pipeline segment GeoJSON API."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch


class GemPipelineSegmentsTests(unittest.TestCase):
    def test_geojson_query_binds_simplify_tolerance_before_bbox(self):
        """SELECT %s appears before WHERE bbox %s placeholders — tolerance must be first."""
        conn = MagicMock()
        cursor = MagicMock()
        cursor.fetchone.side_effect = [(5,), (None,)]
        cursor.fetchall.return_value = []
        conn.cursor.return_value.__enter__.return_value = cursor

        try:
            perf_path = "backend.services.license_map_perf.simplify_tolerance_for_zoom"
            from backend.services.gem_pipeline_segments import get_gem_pipelines_geojson
        except ImportError:
            perf_path = "services.license_map_perf.simplify_tolerance_for_zoom"
            from services.gem_pipeline_segments import get_gem_pipelines_geojson

        with patch(perf_path, return_value=0.08):

            get_gem_pipelines_geojson(
                conn,
                bbox=(1.0, -8.0, 15.0, 6.0),
                zoom=7,
                limit=5000,
            )

        execute_calls = [call.args for call in cursor.execute.call_args_list]
        geojson_call = execute_calls[-1]
        sql, params = geojson_call
        self.assertIn("ST_SimplifyPreserveTopology", sql)
        self.assertEqual(params[0], 0.08)
        self.assertEqual(tuple(params[1:5]), (-8.0, 1.0, 6.0, 15.0))
        self.assertEqual(params[5], 5000)


if __name__ == "__main__":
    unittest.main()
