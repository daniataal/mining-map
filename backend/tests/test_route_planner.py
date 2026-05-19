import unittest
from unittest.mock import MagicMock, patch

from backend.services.route_planner import plan_route
from backend.services.routing_geometry import fetch_osrm_route, repair_known_sea_chokepoints
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
    def test_sea_chokepoint_repair_adds_gibraltar_guard_waypoints(self):
        repaired, changed = repair_known_sea_chokepoints(
            [
                (34.4, -7.1),
                (35.95, -5.75),
            ]
        )

        self.assertTrue(changed)
        self.assertGreater(len(repaired), 2)
        self.assertTrue(any(abs(lat - 35.8) < 0.01 and abs(lng + 6.4) < 0.01 for lat, lng in repaired))

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
        self.assertEqual(air_leg["geometry_source"], "air_great_circle_trunk")
        self.assertIn("routing_engine", air_leg)
        self.assertIn("limitations", air_leg)
        self.assertTrue(air_leg["routing_engine"])

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
    def test_ghana_supplier_haifa_buyer_sea_staged_corridor(self):
        """Supplier Accra → buyer Haifa: export Tema, sea trunk to Haifa (not reversed)."""
        result = plan_route(
            {
                "product": "Gold concentrate",
                "quantity_tons": 1000,
                "origin": {
                    "name": "Accra mine",
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

        legs = result["route"]["legs"]
        sea_leg = next(leg for leg in legs if leg["method"] == "sea")
        self.assertIn("Tema", sea_leg["from"]["name"])
        self.assertIn("Haifa", sea_leg["to"]["name"])
        self.assertGreater(sea_leg["from"]["lat"], 0)
        self.assertGreater(sea_leg["to"]["lat"], 25)
        path = sea_leg["path"]
        self.assertGreater(len(path), 6)
        self.assertLess(path[0][0], 15)
        self.assertGreater(path[-1][0], 25)

    def test_ghana_supplier_israel_buyer_stale_coords_use_haifa_import(self):
        """Buyer country Israel with Ghana coordinates must not terminate sea at Eilat."""
        result = plan_route(
            {
                "product": "Gold concentrate",
                "quantity_tons": 500,
                "origin": {
                    "name": "Accra",
                    "lat": 5.548,
                    "lng": -0.192,
                    "kind": "origin",
                    "metadata": {"country": "Ghana"},
                },
                "destination": {
                    "name": "Buyer",
                    "lat": 5.548,
                    "lng": -0.192,
                    "kind": "destination",
                    "metadata": {"country": "Israel"},
                },
                "preferred_methods": ["sea", "road"],
            }
        )

        sea_leg = next(leg for leg in result["route"]["legs"] if leg["method"] == "sea")
        self.assertIn("Haifa", sea_leg["to"]["name"])
        self.assertNotIn("Eilat", sea_leg["to"]["name"])

    def test_ghana_supplier_eilat_destination_uses_explicit_eilat_port(self):
        result = plan_route(
            {
                "product": "Gold concentrate",
                "quantity_tons": 500,
                "origin": {
                    "name": "Accra",
                    "lat": 5.548,
                    "lng": -0.192,
                    "kind": "origin",
                    "metadata": {"country": "Ghana"},
                },
                "destination": {
                    "name": "Port of Eilat",
                    "lat": 29.557,
                    "lng": 34.952,
                    "kind": "port",
                    "metadata": {"country": "Israel"},
                },
                "preferred_methods": ["sea", "road"],
            }
        )

        sea_leg = next(leg for leg in result["route"]["legs"] if leg["method"] == "sea")
        self.assertIn("Eilat", sea_leg["to"]["name"])
        self.assertNotIn("Haifa", sea_leg["to"]["name"])
        self.assertFalse(
            any(leg["method"] == "road" and "Eilat" in leg["to"]["name"] for leg in result["route"]["legs"]),
            "Destination is already the selected seaport; final road connector should not be added.",
        )

    @patch("backend.services.routing_geometry.SEAROUTE_ENABLED", False)
    def test_ghana_to_eilat_fallback_corridor_uses_red_sea_anchors(self):
        result = plan_route(
            {
                "product": "Gold concentrate",
                "quantity_tons": 500,
                "origin": {
                    "name": "Accra",
                    "lat": 5.548,
                    "lng": -0.192,
                    "kind": "origin",
                    "metadata": {"country": "Ghana"},
                },
                "destination": {
                    "name": "Port of Eilat",
                    "lat": 29.557,
                    "lng": 34.952,
                    "kind": "port",
                    "metadata": {"country": "Israel"},
                },
                "preferred_methods": ["sea", "road"],
            }
        )

        sea_leg = next(leg for leg in result["route"]["legs"] if leg["method"] == "sea")
        self.assertEqual(sea_leg["geometry_source"], "corridor_fallback")
        self.assertIn("Eilat", sea_leg["to"]["name"])
        path = sea_leg["path"]
        self.assertTrue(any(29.0 <= lat <= 30.5 and 32.0 <= lng <= 33.0 for lat, lng in path))
        self.assertTrue(any(27.0 <= lat <= 29.0 and 34.0 <= lng <= 35.0 for lat, lng in path))

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

    @patch("backend.services.routing_geometry.requests.get")
    def test_ghana_to_tlv_sea_includes_road_delivery_via_haifa(self, mock_get: MagicMock):
        """West Africa → Ben Gurion: sea trunk to Haifa, OSRM road connector to TLV (not skipped)."""
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = _osrm_mock_response(distance_m=92_000, duration_s=4500)
        mock_get.return_value = response

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
                    "name": "Ben Gurion Airport (TLV)",
                    "lat": 32.011,
                    "lng": 34.87,
                    "kind": "airport",
                    "metadata": {"country": "Israel"},
                },
                "preferred_methods": ["sea", "road"],
            }
        )

        legs = result["route"]["legs"]
        self.assertGreaterEqual(len(legs), 2)
        sea_leg = next(leg for leg in legs if leg["method"] == "sea")
        self.assertIn("Haifa", sea_leg["to"]["name"])
        road_legs = [leg for leg in legs if leg["method"] == "road"]
        self.assertTrue(road_legs, "Expected road connector from import port to TLV airport")
        final_road = road_legs[-1]
        self.assertGreater(len(final_road["path"]), 2)
        self.assertLess(abs(final_road["to"]["lat"] - 32.011), 0.5)
        self.assertLess(abs(final_road["to"]["lng"] - 34.87), 0.5)

    @patch("backend.services.routing_geometry.SEAROUTE_ENABLED", False)
    def test_ghana_to_tlv_sea_corridor_midpoints_not_deep_inland(self):
        """Rough screen: corridor midpoints should not sit >50 km inside major landmasses."""
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
                    "name": "Ben Gurion Airport (TLV)",
                    "lat": 32.011,
                    "lng": 34.87,
                    "kind": "airport",
                    "metadata": {"country": "Israel"},
                },
                "preferred_methods": ["sea"],
            }
        )

        sea_leg = next(leg for leg in result["route"]["legs"] if leg["method"] == "sea")
        self.assertGreater(len(sea_leg["path"]), 10)

        def _in_sahara_inland(lat: float, lng: float) -> bool:
            return 20.0 < lat < 30.0 and 2.0 < lng < 18.0

        def _in_central_africa_inland(lat: float, lng: float) -> bool:
            return 0.0 < lat < 12.0 and 8.0 < lng < 22.0 and lng > -5.0

        sample = sea_leg["path"][1:-1]
        if len(sample) > 10:
            step = max(1, len(sample) // 10)
            sample = sample[::step]
        for lat, lng in sample:
            self.assertFalse(
                _in_sahara_inland(lat, lng),
                f"Sea midpoint ({lat:.2f}, {lng:.2f}) is deep inland (Sahara shortcut)",
            )
            self.assertFalse(
                _in_central_africa_inland(lat, lng),
                f"Sea midpoint ({lat:.2f}, {lng:.2f}) cuts inland across Africa",
            )

    def test_plan_route_skips_osrm_when_deadline_exhausted(self):
        import backend.services.routing_geometry as routing_geometry

        past_deadline = __import__("time").monotonic() - 1.0
        geometry = routing_geometry.fetch_osrm_route(
            5.548,
            -0.192,
            5.64,
            0.018,
            deadline=past_deadline,
        )
        self.assertEqual(geometry.source, "straight_line_fallback")
        self.assertTrue(
            any("deadline" in note.lower() for note in geometry.notes),
            geometry.notes,
        )

    @patch("backend.services.routing_geometry.requests.get")
    def test_haifa_to_tlv_road_leg_uses_osrm_when_available(self, mock_get: MagicMock):
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = _osrm_mock_response(distance_m=92_000, duration_s=4500)
        mock_get.return_value = response

        result = plan_route(
            {
                "product": "Gold dore",
                "quantity_tons": 2,
                "origin": {
                    "name": "Accra / Tema",
                    "lat": 5.548,
                    "lng": -0.192,
                    "kind": "origin",
                    "metadata": {"country": "Ghana"},
                },
                "destination": {
                    "name": "Ben Gurion Airport (TLV)",
                    "lat": 32.011,
                    "lng": 34.87,
                    "kind": "airport",
                    "metadata": {"country": "Israel"},
                },
                "preferred_methods": ["sea", "road"],
            }
        )

        road_to_tlv = [leg for leg in result["route"]["legs"] if leg["method"] == "road"][-1]
        self.assertIn(road_to_tlv["geometry_source"], {"osrm", "straight_line_fallback"})
        if road_to_tlv["geometry_source"] == "osrm":
            self.assertGreaterEqual(len(road_to_tlv["path"]), 4)

    @patch("backend.services.routing_geometry.fetch_rail_corridor_geometry", return_value=None)
    @patch("backend.services.routing_geometry.requests.get")
    def test_hamburg_frankfurt_rail_avoids_antwerp_hub(self, mock_get: MagicMock, _mock_rail: MagicMock):
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = _osrm_mock_response(distance_m=420_000, duration_s=14_400)
        mock_get.return_value = response

        result = plan_route(
            {
                "product": "Gold concentrate",
                "quantity_tons": 500,
                "origin": {
                    "name": "Port of Hamburg",
                    "lat": 53.545,
                    "lng": 9.97,
                    "kind": "origin",
                    "metadata": {"country": "Germany"},
                },
                "destination": {
                    "name": "Frankfurt Airport",
                    "lat": 50.037,
                    "lng": 8.562,
                    "kind": "destination",
                    "metadata": {"country": "Germany"},
                },
                "preferred_methods": ["rail", "road"],
            }
        )

        legs = result["route"]["legs"]
        self.assertGreaterEqual(len(legs), 1)
        trunk = legs[0]
        self.assertEqual(trunk["method"], "rail")
        notes_text = " ".join(trunk.get("notes") or [])
        self.assertNotIn("Antwerp", notes_text)
        self.assertIn("Hamburg", notes_text)
        self.assertIn("Frankfurt", notes_text)
        self.assertIn(
            trunk["geometry_source"],
            {"rail_osm", "rail_approximation_road", "rail_osrm", "rail_hub", "osrm"},
        )
        self.assertIn("routing_engine", trunk)
        self.assertIsInstance(trunk.get("limitations"), list)
        self.assertGreater(len(trunk["path"]), 2)

    @patch("backend.services.routing_geometry.fetch_rail_corridor_geometry", return_value=None)
    def test_nigeria_inland_origin_no_ocean_rail_polyline(self, _mock_rail: MagicMock):
        result = plan_route(
            {
                "product": "Gold concentrate",
                "quantity_tons": 500,
                "origin": {
                    "name": "Korban Company",
                    "lat": 7.45,
                    "lng": 4.55,
                    "kind": "origin",
                    "metadata": {"country": "Nigeria"},
                },
                "destination": {
                    "name": "Buyer Lagos",
                    "lat": 6.52,
                    "lng": 3.38,
                    "kind": "destination",
                    "metadata": {"country": "Nigeria"},
                },
                "preferred_methods": ["rail", "road"],
            }
        )

        legs = result["route"]["legs"]
        self.assertGreaterEqual(len(legs), 1)
        leg = legs[0]
        self.assertIn(leg["method"], {"rail", "road"})
        path = leg["path"]
        self.assertGreater(len(path), 0)

        def _in_gulf_of_guinea_ocean(lat: float, lng: float) -> bool:
            return -12.0 <= lat <= 8.0 and -18.0 <= lng <= 18.0 and not (5.0 <= lat <= 8.5 and 2.0 <= lng <= 5.5)

        for lat, lng in path:
            self.assertFalse(
                _in_gulf_of_guinea_ocean(lat, lng),
                f"Rail/road path must not cross open Gulf of Guinea at ({lat}, {lng})",
            )
        notes_text = " ".join(leg.get("notes") or [])
        self.assertNotIn("Lobito", notes_text)
        self.assertNotIn("Angola", notes_text)

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
