"""TLS helpers for maritime-worker AISStream WebSocket connections."""

from __future__ import annotations

import os
import ssl
from typing import Any, Optional
from urllib.parse import urlparse


def aisstream_hostname(url: str) -> str:
    """Return the host used for TLS (e.g. stream.aisstream.io)."""
    parsed = urlparse(url)
    return parsed.hostname or url


def maritime_ssl_verify_enabled() -> bool:
    """True unless MARITIME_SSL_VERIFY is explicitly disabled (dev-only workaround)."""
    raw = os.getenv("MARITIME_SSL_VERIFY", "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def maritime_ssl_auto_fallback_enabled() -> bool:
    """
    When True (default), retry AISStream WebSocket with TLS verify off after
    upstream certificate expiry — keeps maritime-worker alive until AISStream renews.
    Set MARITIME_SSL_AUTO_FALLBACK=0 to disable.
    """
    raw = os.getenv("MARITIME_SSL_AUTO_FALLBACK", "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def is_certificate_expired_error(exc: BaseException) -> bool:
    message = str(exc).strip().lower()
    return "certificate has expired" in message or "cert has expired" in message


def should_retry_aisstream_without_tls_verify(exc: BaseException) -> bool:
    """Allow one insecure retry when verify is on but upstream cert is expired."""
    if not maritime_ssl_verify_enabled():
        return False
    if not maritime_ssl_auto_fallback_enabled():
        return False
    return is_certificate_expired_error(exc)


def build_maritime_ssl_context(*, verify: Optional[bool] = None) -> Optional[ssl.SSLContext]:
    """
    SSL context for websockets.connect(ssl=...).

    Uses certifi CA bundle when installed; otherwise Python default (system) trust store.
    When verify=False, returns an unverified context (MARITIME_SSL_VERIFY=0 — dev only).
    """
    should_verify = maritime_ssl_verify_enabled() if verify is None else verify
    if not should_verify:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx

    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def format_maritime_connection_error(url: str, exc: BaseException) -> str:
    """Human-readable AIS connection failure including the TLS peer hostname."""
    host = aisstream_hostname(url)
    message = str(exc).strip() or exc.__class__.__name__
    lowered = message.lower()
    if "certificate has expired" in lowered or "cert has expired" in lowered:
        hint = (
            f" TLS certificate for {host} has expired (upstream AISStream); "
            "renewal is required on their side. For local dev only you may set MARITIME_SSL_VERIFY=0."
        )
    elif "certificate verify failed" in lowered:
        hint = (
            f" TLS verification failed for {host}. "
            "Update ca-certificates in the image (apt install ca-certificates && update-ca-certificates) "
            "or pip install certifi. Dev-only: MARITIME_SSL_VERIFY=0."
        )
    else:
        hint = ""
    return f"AIS watch failed for {host}: {message}{hint}"


def websockets_ssl_argument(url: str, *, verify: Optional[bool] = None) -> Any:
    """Value for websockets.connect(..., ssl=...)."""
    ctx = build_maritime_ssl_context(verify=verify)
    if ctx is not None:
        return ctx
    return True
