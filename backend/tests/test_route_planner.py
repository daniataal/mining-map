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

    def test_landlocked_origin_returns_alternatives_with_distinct_trunks(self):
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
                "preferred_methods": ["sea", "air", "road"],
            }
        )

        self.assertTrue(result["routing_context"]["inland_origin"])
        self.assertIn("recommended", result)
        self.assertGreaterEqual(len(result["alternatives"]), 1)
        self.assertEqual(result["route"]["legs"], result["recommended"]["route"]["legs"])

        all_plans = [result["recommended"], *result["alternatives"]]
        trunk_methods = set()
        for plan in all_plans:
            legs = plan["route"]["legs"]
            trunk = next((leg["method"] for leg in legs if leg["method"] in {"sea", "air"}), None)
            self.assertIsNotNone(trunk)
            trunk_methods.add(trunk)
            trunk_legs = [leg for leg in legs if leg["method"] in {"sea", "air"}]
            self.assertEqual(len(trunk_legs), 1, "Each plan must have exactly one trunk leg")
        self.assertIn("sea", trunk_methods)
        self.assertIn("air", trunk_methods)

    def test_egypt_origin_air_route_uses_domestic_airport_not_dubai(self):
        result = plan_route(
            {
                "product": "Gold concentrate",
                "quantity_tons": 5,
                "origin": {
                    "name": "Abu Tartur Mine",
                    "lat": 26.5,
                    "lng": 28.5,
                    "kind": "origin",
                    "metadata": {"country": "Egypt"},
                },
                "destination": {
                    "name": "Antwerp",
                    "lat": 51.219,
                    "lng": 4.402,
                    "kind": "destination",
                    "metadata": {"country": "Belgium"},
                },
                "preferred_methods": ["air"],
            }
        )

        legs = result["route"]["legs"]
        self.assertEqual(len(legs), 3)
        self.assertEqual(legs[0]["method"], "road")
        self.assertEqual(legs[1]["method"], "air")
        self.assertEqual(legs[2]["method"], "road")

        transit_names = [p["name"] for p in result["route"]["transit_points"]]
        export_airport = legs[0]["to"]["name"]
        import_airport = legs[1]["to"]["name"]
        air_from = legs[1]["from"]["name"]
        air_to = legs[1]["to"]["name"]

        self.assertNotIn("Dubai", export_airport)
        self.assertNotIn("Dubai", air_from)
        egyptian_airports = ("Cairo", "Borg El Arab", "Hurghada", "Luxor")
        self.assertTrue(
            any(token in export_airport for token in egyptian_airports),
            f"Expected Egyptian export airport, got {export_airport}",
        )
        self.assertTrue(
            any(token in import_airport for token in ("Brussels", "Amsterdam")),
            f"Expected Benelux import airport near Antwerp, got {import_airport}",
        )
        self.assertIn("Brussels", import_airport)
        self.assertEqual(air_from, export_airport)
        self.assertEqual(air_to, import_airport)
        self.assertNotIn("Dubai", transit_names)

    def test_egypt_origin_sea_route_prefers_port_said_over_foreign_hub(self):
        result = plan_route(
            {
                "product": "Gold concentrate",
                "quantity_tons": 100,
                "origin": {
                    "name": "Abu Tartur Mine",
                    "lat": 26.5,
                    "lng": 28.5,
                    "kind": "origin",
                    "metadata": {"country": "Egypt"},
                },
                "destination": {
                    "name": "Antwerp",
                    "lat": 51.219,
                    "lng": 4.402,
                    "kind": "destination",
                    "metadata": {"country": "Belgium"},
                },
                "preferred_methods": ["sea"],
            }
        )

        export_port = result["route"]["legs"][0]["to"]["name"]
        self.assertIn("Port Said", export_port)
        self.assertNotIn("Jebel Ali", export_port)


    def test_israel_maritime_and_air_hubs_in_catalog(self):
        from backend.services.route_planner import AIR_HUBS, MARITIME_HUBS

        maritime_names = {h.name for h in MARITIME_HUBS}
        air_names = {h.name for h in AIR_HUBS}
        self.assertIn("Haifa Port", maritime_names)
        self.assertIn("Port of Eilat", maritime_names)
        self.assertIn("Ben Gurion Airport (TLV)", air_names)

    def test_europe_to_haifa_sea_terminates_in_israel_not_durban(self):
        result = plan_route(
            {
                "product": "Gold concentrate",
                "quantity_tons": 1000,
                "origin": {
                    "name": "Hamburg",
                    "lat": 53.545,
                    "lng": 9.97,
                    "kind": "origin",
                    "metadata": {"country": "Germany"},
                },
                "destination": {
                    "name": "Haifa Port",
                    "lat": 32.819,
                    "lng": 34.99,
                    "kind": "destination",
                    "metadata": {"country": "Israel"},
                },
                "preferred_methods": ["sea"],
            }
        )

        legs = result["route"]["legs"]
        sea_leg = next(leg for leg in legs if leg["method"] == "sea")
        import_port = sea_leg["to"]["name"]
        self.assertIn("Haifa", import_port)
        self.assertNotIn("Durban", import_port)
        if len(legs) >= 2:
            final_leg = legs[-1]
            self.assertLess(
                abs(final_leg["to"]["lat"] - 32.819) + abs(final_leg["to"]["lng"] - 34.99),
                2.0,
                "Final leg should deliver near Haifa buyer coordinates",
            )

    def test_israel_country_with_stale_coords_still_uses_israeli_sea_port(self):
        """Buyer country Israel but lat/lng still at Durban must not route sea trunk to Durban."""
        result = plan_route(
            {
                "product": "Gold concentrate",
                "quantity_tons": 500,
                "origin": {
                    "name": "Hamburg",
                    "lat": 53.545,
                    "lng": 9.97,
                    "kind": "origin",
                    "metadata": {"country": "Germany"},
                },
                "destination": {
                    "name": "Haifa Port",
                    "lat": -29.868,
                    "lng": 31.05,
                    "kind": "destination",
                    "metadata": {"country": "Israel"},
                },
                "preferred_methods": ["sea"],
            }
        )

        sea_leg = next(leg for leg in result["route"]["legs"] if leg["method"] == "sea")
        import_port = sea_leg["to"]["name"]
        self.assertNotIn("Durban", import_port)
        self.assertTrue(
            any(token in import_port for token in ("Haifa", "Ashdod", "Eilat")),
            f"Expected Israeli import port, got {import_port}",
        )

    @patch("backend.services.routing_geometry.SEAROUTE_ENABLED", False)
    def test_ghana_to_haifa_sea_corridor_avoids_sahara_shortcut(self):
        """West Africa → Levant must use offshore anchors, not a geodesic over the Sahara."""
        result = plan_route(
                {
                    "product": "Gold concentrate",
                    "quantity_tons": 1000,
                    "origin": {
                        "name": "Accra / Tema",
                        "lat": 5.548,
                        "lng": -0.192,
                        "kind": "origin",
                        "metadata": {"country": "Ghana"},
                    },
                    "destination": {
                        "name": "Haifa Port",
                        "lat": 32.819,
                        "lng": 34.99,
                        "kind": "destination",
                        "metadata": {"country": "Israel"},
                    },
                    "preferred_methods": ["sea", "road"],
                }
        )

        sea_leg = next(leg for leg in result["route"]["legs"] if leg["method"] == "sea")
        self.assertGreater(len(sea_leg["path"]), 6)
        self.assertIn(sea_leg["geometry_source"], {"corridor_fallback", "searoute"})

        def _in_sahara_shortcut(lat: float, lng: float) -> bool:
            return 20.0 < lat < 30.0 and 2.0 < lng < 18.0

        sample = sea_leg["path"][1:-1]
        if len(sample) > 8:
            step = max(1, len(sample) // 8)
            sample = sample[::step]
        for lat, lng in sample:
            self.assertFalse(
                _in_sahara_shortcut(lat, lng),
                f"Sea corridor midpoint ({lat:.2f}, {lng:.2f}) cuts across Sahara landmass",
            )

    def test_israel_airport_destination_sea_mode_uses_domestic_port(self):
        result = plan_route(
            {
                "product": "Gold dore",
                "quantity_tons": 2,
                "origin": {
                    "name": "Hamburg",
                    "lat": 53.545,
                    "lng": 9.97,
                    "kind": "origin",
                    "metadata": {"country": "Germany"},
                },
                "destination": {
                    "name": "Ben Gurion Airport (TLV)",
                    "lat": 32.011,
                    "lng": 34.87,
                    "kind": "destination",
                    "metadata": {"country": "Israel"},
                },
                "preferred_methods": ["sea"],
            }
        )

        sea_leg = next(leg for leg in result["route"]["legs"] if leg["method"] == "sea")
        import_port = sea_leg["to"]["name"]
        self.assertTrue(
            any(token in import_port for token in ("Haifa", "Ashdod", "Eilat")),
            f"Sea trunk should end at Israeli seaport, not airport; got {import_port}",
        )
        self.assertNotIn("Durban", import_port)


if __name__ == "__main__":
    unittest.main()
