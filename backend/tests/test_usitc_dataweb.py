"""USITC DataWeb helper tests (no network)."""

from unittest.mock import MagicMock, patch

from backend.services.usitc_dataweb import (
    PETROLEUM_HS,
    build_usitc_report_query,
    fetch_usitc_us_flow_rows,
    parse_usitc_report_rows,
    sync_usitc_dataweb_flows,
)


def test_petroleum_hs_codes():
    assert "2709" in PETROLEUM_HS
    assert "2711" in PETROLEUM_HS


def test_build_usitc_report_query_sets_hs_and_year():
    query = build_usitc_report_query(hs_code="2709", year=2023, trade_type="Import")
    assert query["reportOptions"]["tradeType"] == "Import"
    assert query["searchOptions"]["commodities"]["commoditiesManual"] == "2709"
    assert query["searchOptions"]["componentSettings"]["years"] == ["2023"]


def test_parse_usitc_report_rows_extracts_partner_and_value():
    payload = {
        "dto": {
            "tables": [
                {
                    "column_groups": [
                        {"columns": [{"label": "Country"}, {"label": "HTS Number"}, {"label": "Customs Value"}]}
                    ],
                    "row_groups": [
                        {
                            "rowsNew": [
                                {
                                    "rowEntries": [
                                        {"value": "Canada"},
                                        {"value": "270900"},
                                        {"value": "1234567"},
                                    ]
                                }
                            ]
                        }
                    ],
                }
            ]
        }
    }
    rows = parse_usitc_report_rows(payload, hs_code="2709", year=2023, trade_type="Import")
    assert len(rows) == 1
    assert rows[0]["partner"] == "Canada"
    assert rows[0]["hs_code"] == "2709"
    assert rows[0]["trade_value_usd"] == 1234567
    assert rows[0]["flow_type"] == "M"
    assert rows[0]["data_source"] == "usitc_dataweb"


def test_sync_skips_without_api_key():
    result = sync_usitc_dataweb_flows(object(), api_key="")
    assert result["status"] == "skipped"
    assert "dataweb.usitc.gov" in result["reason"]


def test_sync_upserts_with_mocked_usitc_response():
    mocked_rows = [
        {
            "reporter": "United States",
            "reporter_m49": "840",
            "reporter_iso2": "US",
            "partner": "Canada",
            "partner_m49": "124",
            "hs_code": "2709",
            "flow_type": "M",
            "year": 2023,
            "trade_value_usd": 999_000,
            "data_source": "usitc_dataweb",
        }
    ]
    conn = MagicMock()
    with patch(
        "backend.services.usitc_dataweb.fetch_usitc_us_flow_rows",
        return_value=(mocked_rows, None),
    ), patch("backend.ingest_oil_trades.ensure_table"), patch(
        "backend.ingest_oil_trades.upsert_rows", return_value=1
    ) as upsert:
        result = sync_usitc_dataweb_flows(conn, api_key="test-token", year=2023)

    assert result["status"] == "ok"
    assert result["rows_upserted"] == 1
    assert result["data_source"] == "usitc_dataweb"
    upsert.assert_called_once_with(conn, mocked_rows)


def test_fetch_usitc_parses_mocked_http_json():
    payload = {
        "dto": {
            "tables": [
                {
                    "column_groups": [
                        {"columns": [{"label": "Country"}, {"label": "Customs Value"}]}
                    ],
                    "row_groups": [
                        {
                            "rowsNew": [
                                {"rowEntries": [{"value": "Mexico"}, {"value": "5000"}]}
                            ]
                        }
                    ],
                }
            ]
        }
    }
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = payload

    with patch("backend.services.usitc_dataweb.requests.post", return_value=mock_resp):
        rows, err = fetch_usitc_us_flow_rows(year=2023, api_key="token", hs_codes=("2709",))

    assert err is None
    assert len(rows) >= 1
    assert rows[0]["partner"] == "Mexico"
    assert rows[0]["data_source"] == "usitc_dataweb"
