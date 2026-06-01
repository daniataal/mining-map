"""Census trade helper tests (no network)."""

from backend.services.census_trade import PETROLEUM_HS, _default_year


def test_petroleum_hs_codes():
    assert "2709" in PETROLEUM_HS
    assert "2710" in PETROLEUM_HS
    assert "2711" in PETROLEUM_HS


def test_default_year_sane():
    y = _default_year()
    assert 2020 <= y <= 2030
