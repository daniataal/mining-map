"""Unit tests for oil_live_graph_sync helpers (no DB required)."""

from __future__ import annotations

import pytest

try:
    from backend.services.oil_live_graph_sync import (
        _commodity_from_text,
        _merge_company_metadata,
        _normalize_name,
    )
except ImportError:
    from services.oil_live_graph_sync import (
        _commodity_from_text,
        _merge_company_metadata,
        _normalize_name,
    )


def test_normalize_name():
    assert _normalize_name("  Aramco Trading  ") == "aramco trading"


@pytest.mark.parametrize(
    "text,expected",
    [
        ("crude oil export", "crude"),
        ("diesel import", "refined"),
        ("LNG terminal", "gas"),
        ("sulfur bulk", "sulfur"),
    ],
)
def test_commodity_from_text(text, expected):
    assert _commodity_from_text(text) == expected


def test_merge_company_metadata_roles_and_sources():
    merged = _merge_company_metadata(
        {"roles": ["terminal_operator"], "sources": [{"name": "osm_storage"}]},
        {"license_id": "lic-1"},
        source="licenses",
        company_type="supplier_license",
    )
    assert merged["roles"] == ["terminal_operator", "supplier_license"]
    names = [s["name"] for s in merged["sources"]]
    assert names == ["osm_storage", "licenses"]
