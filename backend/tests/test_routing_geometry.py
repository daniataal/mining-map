import unittest
from unittest.mock import MagicMock, patch

from backend.services.routing_geometry import (
    fetch_sea_route,
    rail_corridor_viable,
    rail_hub_geometry,
    segment_likely_crosses_ocean,
)
from backend.services.routing_leg_metadata import routing_engine_label


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

    @patch("backend.services.routing_geometry.fetch_rail_corridor_geometry", return_value=None)
    @patch("backend.services.routing_geometry.fetch_osrm_route")
    def test_rail_hub_geometry_uses_osrm_segments(self, mock_osrm: MagicMock, _mock_osm: MagicMock):
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
        self.assertIn(
            resolved.source,
            {"rail_osm", "rail_approximation_road", "rail_osrm", "rail_hub"},
        )
        self.assertGreater(len(resolved.path), 2)
        mock_osrm.assert_called()

    @patch("backend.services.routing_geometry.fetch_rail_corridor_geometry")
    def test_rail_hub_geometry_uses_osm_trunk_when_mapped(self, mock_osm: MagicMock):
        mock_osm.return_value = [
            (53.55, 10.0),
            (52.0, 9.2),
            (50.12, 8.66),
        ]

        with patch("backend.services.routing_geometry.fetch_osrm_route") as mock_osrm:
            mock_osrm.return_value = type(
                "G",
                (),
                {
                    "path": ((53.545, 9.97), (53.55, 10.0)),
                    "distance_km": 5.0,
                    "duration_hours": 0.2,
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
        self.assertEqual(resolved.source, "rail_osm")
        mock_osm.assert_called()

    @patch("backend.services.routing_geometry.fetch_rail_corridor_geometry", return_value=None)
    @patch("backend.services.routing_geometry.fetch_osrm_route")
    def test_rail_hub_geometry_road_approximation_when_osm_empty(
        self, mock_osrm: MagicMock, _mock_osm: MagicMock
    ):
        mock_osrm.return_value = type(
            "G",
            (),
            {
                "path": ((53.545, 9.97), (52.0, 9.0), (50.107, 8.662)),
                "distance_km": 400.0,
                "duration_hours": 8.0,
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
        self.assertEqual(resolved.source, "rail_approximation_road")

    @patch("backend.services.routing_geometry.SEAROUTE_ENABLED", False)
    def test_sea_route_corridor_notes_offshore(self):
        corridor = [(5.64, 0.02), (3.0, -12.0), (28.0, -14.5), (32.82, 34.99)]
        resolved = fetch_sea_route(
            5.64,
            0.02,
            32.82,
            34.99,
            corridor_fallback=lambda: corridor,
        )
        self.assertEqual(resolved.source, "corridor_fallback")
        self.assertGreater(len(resolved.path), 2)

    def test_routing_engine_labels(self):
        self.assertEqual(routing_engine_label("osrm", "road"), "Real road (OSRM)")
        self.assertEqual(routing_engine_label("searoute", "sea"), "Marine network (searoute)")
        self.assertEqual(
            routing_engine_label("air_great_circle_trunk", "air"),
            "Flight path (great-circle, not airways)",
        )


if __name__ == "__main__":
    unittest.main()
