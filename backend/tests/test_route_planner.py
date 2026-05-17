import unittest

from backend.services.route_planner import plan_route
from backend.services.shipping_costs import estimate_route_cost


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
        self.assertIn("limitations", result)


if __name__ == "__main__":
    unittest.main()
