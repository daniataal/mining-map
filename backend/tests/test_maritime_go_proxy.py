"""Tests for maritime Go proxy helper."""

import json
import unittest
from unittest import mock

from backend.services import maritime_go_proxy as proxy


class MaritimeGoProxyTests(unittest.TestCase):
    @mock.patch("urllib.request.urlopen")
    def test_proxy_oil_live_get_success(self, mock_urlopen):
        payload = {"worker": {"status": "ok"}}
        mock_resp = mock.Mock()
        mock_resp.read.return_value = json.dumps(payload).encode("utf-8")
        mock_resp.__enter__ = mock.Mock(return_value=mock_resp)
        mock_resp.__exit__ = mock.Mock(return_value=False)
        mock_urlopen.return_value = mock_resp

        body = proxy.proxy_oil_live_get("/api/oil-live/maritime/stats")
        self.assertEqual(body["worker"]["status"], "ok")

    @mock.patch("urllib.request.urlopen", side_effect=OSError("connection refused"))
    def test_proxy_oil_live_get_error(self, _mock_urlopen):
        body = proxy.proxy_oil_live_get("/api/oil-live/maritime/stats")
        self.assertTrue(body.get("proxy_error"))
        self.assertIn("connection refused", body.get("error", ""))


if __name__ == "__main__":
    unittest.main()
