"""Tests for maritime Go proxy helper."""

import io
import json
import unittest
import urllib.error
from email.message import Message
from unittest import mock

from backend.services import maritime_go_proxy as proxy


class MaritimeGoProxyTests(unittest.TestCase):
    @mock.patch("urllib.request.urlopen")
    def test_proxy_oil_live_get_success(self, mock_urlopen):
        payload = {"worker": {"status": "ok"}}
        mock_resp = mock.Mock()
        mock_resp.read.return_value = json.dumps(payload).encode("utf-8")
        mock_resp.status = 200
        mock_resp.headers = Message()
        mock_resp.headers["Content-Type"] = "application/json"
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

    @mock.patch("urllib.request.urlopen")
    def test_proxy_oil_live_get_forward_preserves_404(self, mock_urlopen):
        err_body = json.dumps({"error": "not found"}).encode("utf-8")
        hdrs = Message()
        hdrs["Content-Type"] = "application/json"
        exc = urllib.error.HTTPError(
            url="http://oil-live-intel:8095/api/oil-live/licenses",
            code=404,
            msg="Not Found",
            hdrs=hdrs,
            fp=io.BytesIO(err_body),
        )
        mock_urlopen.side_effect = exc
        body, status, content_type = proxy.proxy_oil_live_get_forward(
            "/api/oil-live/licenses/country-summary",
            {"limit": 10},
        )
        self.assertEqual(status, 404)
        self.assertEqual(content_type, "application/json")
        self.assertEqual(body["error"], "not found")


if __name__ == "__main__":
    unittest.main()
