"""Marketplace license export helpers (fail closed without a real API key)."""
import os


def marketplace_export_configured() -> bool:
    """True when MARKETPLACE_API_KEY is set and not the dev placeholder demo-key."""
    key = (os.getenv("MARKETPLACE_API_KEY") or "").strip()
    return bool(key) and key.lower() != "demo-key"
