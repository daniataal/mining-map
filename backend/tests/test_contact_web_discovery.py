import unittest
from unittest.mock import patch

from backend.services import contact_web_discovery as cwd


class NormalizeCompanyNameTests(unittest.TestCase):
    def test_ampersand_spacing_and_suffix(self):
        self.assertEqual(
            cwd.normalize_company_name_for_search("M&C TRADING & LOGISTICS LIMITED"),
            "M & C TRADING & LOGISTICS",
        )
        self.assertEqual(
            cwd.normalize_company_name_for_search("M & C  TRADING & LOGISTICS LTD"),
            "M & C TRADING & LOGISTICS",
        )

    def test_punctuation_stripped(self):
        self.assertEqual(
            cwd.normalize_company_name_for_search("Foo-Bar, Mining (Ghana) PLC"),
            "Foo Bar Mining Ghana",
        )


class RobotsParserTests(unittest.TestCase):
    def test_star_block_disallow(self):
        body = """User-agent: *\nDisallow: /admin\nDisallow: /private\n\nUser-agent: Googlebot\nDisallow: /\n"""
        prefixes = cwd._parse_robots_disallow_prefixes(body)
        self.assertEqual(prefixes, ["/admin", "/private"])


class HtmlExtractionTests(unittest.TestCase):
    def test_mailto_tel_and_contact_link(self):
        html = """
        <html><body>
        <a href="mailto:info@mnclogisticsandtrading.com">mail</a>
        <a href="tel:+233-30-123-4567">call</a>
        <a href="/contact-us">c</a>
        </body></html>
        """
        emails, phones, extra = cwd.extract_public_contacts_from_html(
            html, "https://mnclogisticsandtrading.com/page"
        )
        self.assertIn("info@mnclogisticsandtrading.com", emails)
        self.assertTrue(any("+233" in p for p in phones))
        self.assertIn("https://mnclogisticsandtrading.com/contact-us", extra)


class DiscoverWebContactsTests(unittest.TestCase):
    @patch.object(cwd, "_http_get")
    @patch.object(cwd, "discover_search_result_urls")
    def test_end_to_end_merge_extracts(self, mock_discover_urls, mock_http):
        mock_discover_urls.return_value = (["https://mnclogisticsandtrading.com/"], "google_cse")
        mock_http.side_effect = [
            (404, "text/plain", ""),  # robots.txt missing → allow fetch
            (
                200,
                "text/html",
                '<html><body><a href="mailto:ops@example.com">x</a>'
                '<a href="tel:+233301112233">t</a></body></html>',
            ),
        ]

        found, diag = cwd.discover_web_contact_candidates(
            entity_id="gh-test-1",
            company="M & C TRADING & LOGISTICS LIMITED",
            country="Ghana",
            google_cse_key="k",
            google_cse_cx="cx",
            serpapi_key="",
        )
        self.assertEqual(diag["engine"], "google_cse")
        self.assertIn("M & C TRADING & LOGISTICS", diag.get("query", ""))
        types = {c["contact_type"] for c in found}
        self.assertIn("email", types)
        self.assertIn("phone", types)
        self.assertIn("website", types)


if __name__ == "__main__":
    unittest.main()
