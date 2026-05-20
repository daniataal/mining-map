import os
import ssl
import unittest
from unittest import mock

from services.maritime_ssl import (
    aisstream_hostname,
    build_maritime_ssl_context,
    format_maritime_connection_error,
    maritime_ssl_verify_enabled,
    websockets_ssl_argument,
)


class MaritimeSslTests(unittest.TestCase):
    def test_aisstream_hostname(self):
        self.assertEqual(
            aisstream_hostname("wss://stream.aisstream.io/v0/stream"),
            "stream.aisstream.io",
        )

    def test_maritime_ssl_verify_enabled_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("MARITIME_SSL_VERIFY", None)
            self.assertTrue(maritime_ssl_verify_enabled())

    def test_maritime_ssl_verify_disabled(self):
        with mock.patch.dict(os.environ, {"MARITIME_SSL_VERIFY": "0"}, clear=False):
            self.assertFalse(maritime_ssl_verify_enabled())

    def test_build_maritime_ssl_context_verify_off(self):
        ctx = build_maritime_ssl_context(verify=False)
        self.assertIsInstance(ctx, ssl.SSLContext)
        self.assertEqual(ctx.verify_mode, ssl.CERT_NONE)

    def test_build_maritime_ssl_context_verify_on(self):
        ctx = build_maritime_ssl_context(verify=True)
        self.assertIsInstance(ctx, ssl.SSLContext)
        self.assertNotEqual(ctx.verify_mode, ssl.CERT_NONE)

    def test_format_expired_cert_includes_hostname(self):
        msg = format_maritime_connection_error(
            "wss://stream.aisstream.io/v0/stream",
            ssl.SSLCertVerificationError(
                "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: certificate has expired"
            ),
        )
        self.assertIn("stream.aisstream.io", msg)
        self.assertIn("expired", msg.lower())
        self.assertIn("AIS watch failed for", msg)

    def test_format_generic_error_includes_hostname(self):
        msg = format_maritime_connection_error(
            "wss://stream.aisstream.io/v0/stream",
            ConnectionError("connection reset"),
        )
        self.assertIn("stream.aisstream.io", msg)
        self.assertIn("connection reset", msg)

    def test_websockets_ssl_argument_returns_context(self):
        arg = websockets_ssl_argument("wss://stream.aisstream.io/v0/stream")
        self.assertIsInstance(arg, ssl.SSLContext)


if __name__ == "__main__":
    unittest.main()
