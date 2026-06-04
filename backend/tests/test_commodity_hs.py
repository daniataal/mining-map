"""Tests for shared commodity → HS mapping."""

from __future__ import annotations

import unittest

try:
    from backend.services.commodity_hs import hs_codes_for_entity, resolve_hs
except ImportError:
    from services.commodity_hs import hs_codes_for_entity, resolve_hs  # type: ignore


class TestCommodityHs(unittest.TestCase):
    def test_diesel_maps_to_2710(self) -> None:
        self.assertEqual(resolve_hs("diesel"), "2710")

    def test_gold_maps_to_7108(self) -> None:
        self.assertEqual(resolve_hs("Gold"), "7108")

    def test_copper_maps_to_7403(self) -> None:
        self.assertEqual(resolve_hs("copper ore"), "7403")

    def test_unknown_returns_none(self) -> None:
        self.assertIsNone(resolve_hs("unobtanium"))

    def test_oil_expands_hs27_bundle_when_unmapped(self) -> None:
        codes = hs_codes_for_entity("gas condensate blend")
        self.assertEqual(codes, ["2709", "2710", "2711"])

    def test_gold_single_hs(self) -> None:
        self.assertEqual(hs_codes_for_entity("gold"), ["7108"])


if __name__ == "__main__":
    unittest.main()
