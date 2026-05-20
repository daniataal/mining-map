"""USITC DataWeb helper tests (no network)."""

from backend.services.usitc_dataweb import (
    PETROLEUM_HS,
    build_usitc_report_query,
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
