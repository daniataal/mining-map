"""Tests for EU national company register URL helper."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.services.eu_company_registers import build_eu_register_link, resolve_country_key


class EuCompanyRegistersTests(unittest.TestCase):
    def test_resolve_germany(self):
        self.assertEqual(resolve_country_key("Germany"), "germany")

    def test_build_france_link(self):
        link = build_eu_register_link("TotalEnergies", "France")
        self.assertIsNotNone(link)
        assert link is not None
        self.assertIn("inpi.fr", link["url"])
        self.assertTrue(link["manual_only"])

    def test_ghana_eu_module_returns_none(self):
        self.assertIsNone(build_eu_register_link("Acme", "Ghana"))

    def test_ghana_via_company_registers(self):
        from backend.services.company_registers import build_register_link

        link = build_register_link("Acme", "Ghana")
        self.assertIsNotNone(link)


if __name__ == "__main__":
    unittest.main()
