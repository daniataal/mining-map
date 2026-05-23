import os
import ssl
import unittest
from unittest import mock

from services.maritime_ssl import (
    aisstream_hostname,
    build_maritime_ssl_context,
    format_maritime_connection_error,
    is_certificate_expired_error,
    maritime_ssl_verify_enabled,
    should_retry_aisstream_without_tls_verify,
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

    def test_should_retry_on_expired_cert(self):
        exc = ssl.SSLError("[SSL: CERTIFICATE_VERIFY_FAILED] certificate has expired")
        self.assertTrue(is_certificate_expired_error(exc))
        with mock.patch.dict(os.environ, {"MARITIME_SSL_AUTO_FALLBACK": "1"}, clear=False):
            self.assertTrue(should_retry_aisstream_without_tls_verify(exc))

    def test_no_retry_when_auto_fallback_off(self):
        exc = Exception("certificate has expired")
        with mock.patch.dict(os.environ, {"MARITIME_SSL_AUTO_FALLBACK": "0"}, clear=False):
            self.assertFalse(should_retry_aisstream_without_tls_verify(exc))

    def test_expired_cert_detected_in_cause_chain(self):
        inner = ssl.SSLError("certificate has expired")
        outer = ConnectionError("AIS watch failed")
        outer.__cause__ = inner
        self.assertTrue(is_certificate_expired_error(outer))


if __name__ == "__main__":
    unittest.main()
