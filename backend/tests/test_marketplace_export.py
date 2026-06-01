"""Marketplace export must fail closed without a real API key."""
import os
import unittest
from unittest import mock

from backend.services.marketplace_export import marketplace_export_configured


class MarketplaceExportConfiguredTests(unittest.TestCase):
    def test_unset_key_not_configured(self):
        with mock.patch.dict(os.environ, {"MARKETPLACE_API_KEY": ""}, clear=False):
            self.assertFalse(marketplace_export_configured())

    def test_demo_key_not_configured(self):
        with mock.patch.dict(os.environ, {"MARKETPLACE_API_KEY": "demo-key"}, clear=False):
            self.assertFalse(marketplace_export_configured())

    def test_real_key_configured(self):
        with mock.patch.dict(
            os.environ, {"MARKETPLACE_API_KEY": "prod-secret-key"}, clear=False
        ):
            self.assertTrue(marketplace_export_configured())


if __name__ == "__main__":
    unittest.main()
