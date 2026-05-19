"""Tests for Comtrade API key failover (primary → secondary on 429/403)."""

import os
import unittest
from unittest import mock

from backend.services import comtrade_keys as ck
from backend.ingest_oil_trades import _fetch_comtrade_bulk


class ComtradeKeyFailoverTests(unittest.TestCase):
    def setUp(self) -> None:
        self._prev_primary = os.environ.get("COMTRADE_API_KEY")
        self._prev_secondary = os.environ.get("COMTRADE_API_KEY_SECONDARY")
        os.environ["COMTRADE_API_KEY"] = "primary-key"
        os.environ["COMTRADE_API_KEY_SECONDARY"] = "secondary-key"

    def tearDown(self) -> None:
        for var, prev in (
            ("COMTRADE_API_KEY", self._prev_primary),
            ("COMTRADE_API_KEY_SECONDARY", self._prev_secondary),
        ):
            if prev is None:
                os.environ.pop(var, None)
            else:
                os.environ[var] = prev

    @mock.patch("requests.get")
    def test_get_json_failover_on_429_uses_secondary(self, mock_get: mock.Mock) -> None:
        resp_primary = mock.Mock(status_code=429)
        resp_secondary = mock.Mock(status_code=200)
        resp_secondary.json.return_value = {"data": [{"flowCode": "X"}]}
        mock_get.side_effect = [resp_primary, resp_secondary]

        payload, status = ck.get_json_with_key_failover(
            lambda key: f"https://comtradeapi.un.org/example?subscription-key={key}"
        )

        self.assertEqual(status, 200)
        self.assertEqual(payload, {"data": [{"flowCode": "X"}]})
        self.assertEqual(mock_get.call_count, 2)
        self.assertIn("primary-key", mock_get.call_args_list[0][0][0])
        self.assertIn("secondary-key", mock_get.call_args_list[1][0][0])

    @mock.patch("requests.get")
    def test_get_json_failover_on_403_uses_secondary(self, mock_get: mock.Mock) -> None:
        resp_primary = mock.Mock(status_code=403)
        resp_secondary = mock.Mock(status_code=200)
        resp_secondary.json.return_value = {"data": []}
        mock_get.side_effect = [resp_primary, resp_secondary]

        _payload, status = ck.get_json_with_key_failover(
            lambda key: f"https://example.test/?subscription-key={key}"
        )

        self.assertEqual(status, 200)
        self.assertEqual(mock_get.call_count, 2)

    @mock.patch("backend.services.comtrade_keys.get_json_with_key_failover")
    def test_fetch_comtrade_bulk_delegates_to_failover_helper(
        self, mock_failover: mock.Mock
    ) -> None:
        mock_failover.return_value = (
            {
                "data": [
                    {
                        "reporterDesc": "Canada",
                        "reporterISO": "CA",
                        "partnerDesc": "World",
                        "partnerCode": "0",
                        "flowCode": "X",
                        "period": 2023,
                        "primaryValue": 100,
                        "netWgt": 200,
                    }
                ]
            },
            200,
        )
        rows = _fetch_comtrade_bulk("124", "2709", 2023, "primary-key")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["reporter_iso2"], "CA")
        mock_failover.assert_called()


class PetroleumKeyedFailoverTests(unittest.TestCase):
    def setUp(self) -> None:
        from backend.services import petroleum_trade as pt

        self.pt = pt
        pt.clear_cache()
        self._prev_primary = os.environ.get("COMTRADE_API_KEY")
        self._prev_secondary = os.environ.get("COMTRADE_API_KEY_SECONDARY")
        os.environ["COMTRADE_API_KEY"] = "primary-key"
        os.environ["COMTRADE_API_KEY_SECONDARY"] = "secondary-key"

    def tearDown(self) -> None:
        self.pt.clear_cache()
        for var, prev in (
            ("COMTRADE_API_KEY", self._prev_primary),
            ("COMTRADE_API_KEY_SECONDARY", self._prev_secondary),
        ):
            if prev is None:
                os.environ.pop(var, None)
            else:
                os.environ[var] = prev

    @mock.patch("requests.get")
    def test_fetch_comtrade_keyed_failover_on_429(self, mock_get: mock.Mock) -> None:
        resp_primary = mock.Mock(status_code=429)
        resp_secondary = mock.Mock(status_code=200)
        resp_secondary.json.return_value = {
            "data": [
                {
                    "flowCode": "X",
                    "primaryValue": 50,
                    "netWgt": 10,
                    "partnerDesc": "World",
                    "period": 2023,
                }
            ]
        }
        mock_get.side_effect = [resp_primary, resp_secondary]

        out = self.pt.fetch_comtrade_keyed("124", "2709", year=2023)

        self.assertEqual(out["source_key"], "comtrade_keyed")
        self.assertEqual(len(out["flows"]), 1)
        self.assertEqual(mock_get.call_count, 2)
        self.assertIn("primary-key", mock_get.call_args_list[0][0][0])
        self.assertIn("secondary-key", mock_get.call_args_list[1][0][0])


if __name__ == "__main__":
    unittest.main()
