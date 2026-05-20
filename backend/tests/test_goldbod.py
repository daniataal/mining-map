import unittest
from datetime import date
from unittest.mock import MagicMock

from backend.services import goldbod as svc


REGISTRY_HTML = """
<table><tr><th>SNO</th><th>NAME</th><th>CERT</th><th>ISSUE</th><th>EXPIRY</th></tr>
<tr><td>1</td><td>BAWA-ROCK LTD</td><td>GGB/AGR/RA0103/001/25</td><td>23-Jun-25</td><td>22-Jun-26</td></tr>
<tr><td>2</td><td>SHOWROOM MINING LTD</td><td>GGB/LB2/T20225/035/25</td><td>23-Jun-25</td><td>22-Jun-26</td></tr>
</table>
"""


class GoldbodEligibilityTests(unittest.TestCase):
    def test_ghana_gold_entity(self):
        self.assertTrue(svc.is_ghana_gold_entity(country="Ghana", commodity="Gold"))
        self.assertTrue(svc.is_ghana_gold_entity(country="GH", commodity="gold concentrate"))

    def test_non_ghana_or_non_gold(self):
        self.assertFalse(svc.is_ghana_gold_entity(country="Ghana", commodity="Bauxite"))
        self.assertFalse(svc.is_ghana_gold_entity(country="Peru", commodity="Gold"))


class GoldbodParseTests(unittest.TestCase):
    def test_parse_registry_html(self):
        rows = svc._parse_registry_html(REGISTRY_HTML)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["certificate_number"], "GGB/AGR/RA0103/001/25")
        self.assertEqual(rows[1]["business_name"], "SHOWROOM MINING LTD")

    def test_normalize_company_name(self):
        self.assertEqual(
            svc._normalize_company_name("Showroom Mining Ltd."),
            "SHOWROOM MINING",
        )


class GoldbodVerifyTests(unittest.TestCase):
    def setUp(self):
        svc._REGISTRY_CACHE["fetched_at"] = 0.0
        svc._REGISTRY_CACHE["entries"] = []
        svc._REGISTRY_CACHE["error"] = None

    def _mock_urlopen(self, html: str = REGISTRY_HTML):
        resp = MagicMock()
        resp.read.return_value = html.encode("utf-8")
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)

        def opener(req, timeout=25):
            return resp

        return opener

    def test_active_match_by_company(self):
        payload = svc.verify_goldbod_license(
            company_name="Showroom Mining Ltd",
            country="Ghana",
            commodity="Gold",
            urlopen_fn=self._mock_urlopen(),
        )
        self.assertEqual(payload["status"], "active")
        self.assertTrue(payload["matches"])
        self.assertEqual(payload["active_match"]["business_name"], "SHOWROOM MINING LTD")

    def test_not_found_company(self):
        payload = svc.verify_goldbod_license(
            company_name="Totally Unknown Mining",
            country="Ghana",
            commodity="Gold",
            urlopen_fn=self._mock_urlopen(),
        )
        self.assertEqual(payload["status"], "not_found")
        self.assertEqual(payload["matches"], [])

    def test_match_by_certificate(self):
        payload = svc.verify_goldbod_license(
            license_number="GGB/AGR/RA0103/001/25",
            country="Ghana",
            commodity="Gold",
            urlopen_fn=self._mock_urlopen(),
        )
        self.assertEqual(payload["status"], "active")
        self.assertEqual(payload["matches"][0]["certificate_number"], "GGB/AGR/RA0103/001/25")

    def test_ineligible_skips_lookup(self):
        payload = svc.verify_goldbod_license(
            company_name="Acme",
            country="Chile",
            commodity="Copper",
        )
        self.assertEqual(payload["status"], "unknown")
        self.assertFalse(payload["eligible"])

    def test_registry_fetch_failure(self):
        def fail_open(req, timeout=25):
            raise OSError("network down")

        payload = svc.verify_goldbod_license(
            company_name="Showroom Mining",
            country="Ghana",
            commodity="Gold",
            urlopen_fn=fail_open,
        )
        self.assertEqual(payload["status"], "api_unavailable")

    def test_license_active_expiry(self):
        self.assertTrue(svc._license_active("22-Jun-26", today=date(2026, 1, 1)))
        self.assertFalse(svc._license_active("22-Jun-25", today=date(2026, 1, 1)))


if __name__ == "__main__":
    unittest.main()
