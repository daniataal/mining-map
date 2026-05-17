import unittest
from unittest.mock import MagicMock, patch

from backend.services.route_planner import plan_route
from backend.services.routing_geometry import fetch_osrm_route
from backend.services.shipping_costs import estimate_route_cost


def _osrm_mock_response(distance_m: float = 250_000, duration_s: float = 18_000):
    return {
        "routes": [
            {
                "distance": distance_m,
                "duration": duration_s,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [31.31, -12.57],
                        [31.5, -11.0],
                        [32.0, -8.0],
                        [39.289, -6.823],
                    ],
                },
            }
        ]
    }


class RoutePlannerTests(unittest.TestCase):
    def test_estimate_route_cost_for_sea_and_road(self):
        breakdown = estimate_route_cost(
            [
                {"leg_id": "leg-1", "method": "road", "distance_km": 180},
                {"leg_id": "leg-2", "method": "sea", "distance_km": 950},
            ],
            cargo_tons=100,
        )
        self.assertGreater(breakdown.total_cost_usd, 0)
        self.assertIn("road", breakdown.method_subtotals_usd)
        self.assertIn("sea", breakdown.method_subtotals_usd)
        self.assertEqual(len(breakdown.leg_costs), 2)

    def test_plan_route_pipeline_leg_when_enabled(self):
        result = plan_route(
            {
                "product": "Crude Oil",
                "quantity_tons": 500,
                "origin": {"name": "Field A", "lat": 5.62, "lng": 0.03, "kind": "refinery"},
                "transit_points": [
                    {"name": "Hub B", "lat": 5.80, "lng": 0.15, "kind": "pipeline_node"}
                ],
                "destination": {"name": "Port C", "lat": 5.92, "lng": 0.22, "kind": "port"},
                "preferred_methods": ["pipeline", "road"],
                "pipeline_layer_enabled": True,
            }
        )
        legs = result["route"]["legs"]
        self.assertEqual(len(legs), 1)
        self.assertTrue(all(leg["method"] == "pipeline" for leg in legs))
        self.assertGreater(result["cost_breakdown"]["total_cost_usd"], 0)
        self.assertIn("duration_hours", legs[0])

    def test_plan_route_stages_inland_port_sea_port_delivery(self):
        result = plan_route(
            {
                "product": "Gold concentrate",
                "quantity_tons": 1000,
                "origin": {
                    "name": "PrimeRose Resources Zambia",
                    "lat": -12.57,
                    "lng": 31.31,
                    "kind": "origin",
                    "metadata": {"country": "Zambia"},
                },
                "destination": {
                    "name": "Rotterdam, Netherlands",
                    "lat": 51.924,
                    "lng": 4.477,
                    "kind": "destination",
                    "metadata": {"country": "Netherlands"},
                },
                "preferred_methods": ["sea", "road"],
            }
        )

        legs = result["route"]["legs"]
        self.assertGreaterEqual(len(legs), 2)
        self.assertEqual(legs[0]["method"], "road")
        self.assertTrue(any(leg["method"] == "sea" for leg in legs))
        sea_leg = next(leg for leg in legs if leg["method"] == "sea")
        self.assertGreater(len(sea_leg["path"]), 2)
        self.assertIn("port", sea_leg["from"]["kind"])
        self.assertIn("duration_hours", sea_leg)
        self.assertIn("geometry_source", sea_leg)
        self.assertIn("limitations", result)

    @patch("backend.services.routing_geometry.requests.get")
    def test_osrm_road_geometry_used_when_available(self, mock_get: MagicMock):
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = _osrm_mock_response()
        mock_get.return_value = response

        geometry = fetch_osrm_route(-12.57, 31.31, -6.823, 39.289, method="road")
        self.assertEqual(geometry.source, "osrm")
        self.assertGreater(len(geometry.path), 2)
        self.assertAlmostEqual(geometry.distance_km, 250.0, places=1)
        self.assertGreater(geometry.duration_hours, 0)

    @patch("backend.services.routing_geometry.requests.get")
    def test_osrm_failure_falls_back_without_raising(self, mock_get: MagicMock):
        mock_get.side_effect = ConnectionError("router down")

        geometry = fetch_osrm_route(0.0, 0.0, 1.0, 1.0, method="road")
        self.assertEqual(geometry.source, "straight_line_fallback")
        self.assertEqual(len(geometry.path), 2)

    @patch("backend.services.routing_geometry.requests.get")
    def test_plan_route_succeeds_when_osrm_down(self, mock_get: MagicMock):
        mock_get.side_effect = ConnectionError("router down")
        result = plan_route(
            {
                "product": "Gold concentrate",
                "quantity_tons": 50,
                "origin": {"name": "Mine", "lat": -12.57, "lng": 31.31, "kind": "origin"},
                "destination": {"name": "Port", "lat": -6.823, "lng": 39.289, "kind": "port"},
                "preferred_methods": ["road"],
            }
        )
        self.assertGreater(len(result["route"]["legs"]), 0)
        road_leg = result["route"]["legs"][0]
        self.assertEqual(road_leg["method"], "road")
        self.assertIn(road_leg["geometry_source"], {"straight_line_fallback", "osrm"})

    def test_plan_route_air_leg_has_dense_great_circle(self):
        result = plan_route(
            {
                "product": "Gold dore",
                "quantity_tons": 2,
                "origin": {"name": "Lusaka", "lat": -15.33, "lng": 28.45, "kind": "origin"},
                "destination": {"name": "Amsterdam", "lat": 52.31, "lng": 4.77, "kind": "destination"},
                "preferred_methods": ["air"],
            }
        )
        air_leg = next(leg for leg in result["route"]["legs"] if leg["method"] == "air")
        self.assertGreater(len(air_leg["path"]), 10)
        self.assertEqual(air_leg["geometry_source"], "great_circle")


if __name__ == "__main__":
    unittest.main()
