import unittest

from backend.services.satellite_site import build_satellite_site_payload


class SatelliteSiteTests(unittest.TestCase):
    def test_with_coordinates_includes_links(self):
        payload = build_satellite_site_payload(
            entity_id="lic-1",
            company="Test Co",
            country="Ghana",
            lat=5.6,
            lng=-0.2,
        )
        self.assertTrue(payload["has_coordinates"])
        self.assertEqual(len(payload["links"]), 3)
        self.assertIn("google.com/maps", payload["links"][0]["url"])
        self.assertIn("copernicus.eu", payload["links"][1]["url"])

    def test_without_coordinates_no_links_and_extra_limitation(self):
        payload = build_satellite_site_payload(
            entity_id="lic-2",
            company="No Geo",
            country="Unknown",
            lat=None,
            lng=None,
        )
        self.assertFalse(payload["has_coordinates"])
        self.assertEqual(payload["links"], [])
        self.assertTrue(
            any("no coordinates" in lim.lower() for lim in payload["limitations"])
        )

    def test_esg_zone_passed_through(self):
        zone = {"name": "Kakum Buffer", "restrictions": "No mining"}
        payload = build_satellite_site_payload(
            entity_id="lic-3",
            company="Eco",
            country="Ghana",
            lat=1.0,
            lng=2.0,
            esg_zone=zone,
        )
        self.assertEqual(payload["esg_intersection"], zone)


if __name__ == "__main__":
    unittest.main()
