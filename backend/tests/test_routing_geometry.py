import unittest
from unittest.mock import MagicMock, patch

from backend.services.routing_geometry import (
    rail_corridor_viable,
    rail_hub_geometry,
    segment_likely_crosses_ocean,
)


class RoutingGeometryRailTests(unittest.TestCase):
    def test_segment_likely_crosses_ocean_gulf_of_guinea(self):
        self.assertTrue(
            segment_likely_crosses_ocean(7.0, 4.0, -12.36, 13.54),
            "Nigeria–Angola geodesic should cross Gulf of Guinea open water",
        )

    def test_segment_likely_crosses_ocean_hamburg_frankfurt(self):
        self.assertFalse(segment_likely_crosses_ocean(53.545, 9.97, 50.107, 8.662))

    def test_rail_corridor_viable_rejects_africa_europe(self):
        viable, notes = rail_corridor_viable(
            6.45,
            3.39,
            "Nigeria",
            50.107,
            8.662,
            "Germany",
            origin_country="Nigeria",
            dest_country="Germany",
        )
        self.assertFalse(viable)
        self.assertTrue(
            any("Intercontinental" in note or "exceeds" in note for note in notes),
            notes,
        )

    def test_rail_corridor_viable_accepts_germany_domestic(self):
        viable, _ = rail_corridor_viable(
            53.545,
            9.97,
            "Germany",
            50.107,
            8.662,
            "Germany",
            origin_country="Germany",
            dest_country="Germany",
        )
        self.assertTrue(viable)

    @patch("backend.services.routing_geometry.fetch_osrm_route")
    def test_rail_hub_geometry_uses_osrm_segments(self, mock_osrm: MagicMock):
        mock_osrm.return_value = type(
            "G",
            (),
            {
                "path": ((53.5, 10.0), (52.0, 9.0), (50.1, 8.7)),
                "distance_km": 350.0,
                "duration_hours": 7.0,
                "source": "osrm",
                "notes": [],
            },
        )()

        resolved = rail_hub_geometry(
            53.545,
            9.97,
            50.037,
            8.562,
            export_hub=(53.545, 9.97),
            import_hub=(50.107, 8.662),
            export_hub_country="Germany",
            import_hub_country="Germany",
            origin_country="Germany",
            dest_country="Germany",
        )
        self.assertIsNotNone(resolved)
        assert resolved is not None
        self.assertIn(resolved.source, {"rail_osrm", "rail_hub"})
        self.assertGreater(len(resolved.path), 2)
        mock_osrm.assert_called()


if __name__ == "__main__":
    unittest.main()
