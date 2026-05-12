import unittest

from backend.services.maritime_intel import (
    build_counterparty_proxies,
    classify_ais_ship_type,
    classify_evidence_type,
    haversine_km,
    match_destination_to_port,
    parse_unlocode_coordinates,
)


class MaritimeIntelTests(unittest.TestCase):
    def test_parse_unlocode_coordinates(self):
        lat, lng = parse_unlocode_coordinates("2428N 05422E")
        self.assertAlmostEqual(lat, 24.4667, places=3)
        self.assertAlmostEqual(lng, 54.3667, places=3)

    def test_haversine_km_zero_distance(self):
        self.assertAlmostEqual(haversine_km(1.0, 2.0, 1.0, 2.0), 0.0, places=4)

    def test_classify_ais_ship_type(self):
        self.assertEqual(classify_ais_ship_type(82), (82, "Tanker"))
        self.assertEqual(classify_ais_ship_type(75), (75, "Cargo"))
        self.assertEqual(classify_ais_ship_type(None), (None, "Unknown"))

    def test_classify_evidence_type_counterparty(self):
        title = "Buyer signs LNG supply deal after tanker discharge"
        self.assertEqual(classify_evidence_type(title), "counterparty_signal")

    def test_build_counterparty_proxies_keeps_destination_and_port_proxy(self):
        proxies = build_counterparty_proxies(
            commodity="crude oil",
            matched_port={
                "name": "Ruwais",
                "country_iso2": "AE",
                "confidence": 0.82,
                "source_label": "UN/LOCODE",
                "source_url": "https://unece.org/trade/cefact/UNLOCODE-Download",
            },
            nearest_ports=[
                {
                    "name": "Jebel Ali",
                    "confidence": 0.55,
                    "source_label": "UN/LOCODE",
                    "source_url": "https://unece.org/trade/cefact/UNLOCODE-Download",
                }
            ],
            evidence=[],
        )
        self.assertEqual(len(proxies), 2)
        self.assertEqual(proxies[0]["proxy_type"], "destination_port_proxy")
        self.assertEqual(proxies[1]["proxy_type"], "nearest_port_proxy")

    def test_match_destination_to_port_handles_empty(self):
        self.assertIsNone(match_destination_to_port(""))


if __name__ == "__main__":
    unittest.main()
