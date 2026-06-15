package ingestion

import (
	"strings"
	"testing"
)

func TestLegacyParityCatalog(t *testing.T) {
	catalog := LegacyParityCatalog()
	if len(catalog) != 13 {
		t.Fatalf("expected 13 tables, got %d", len(catalog))
	}
	want := map[string]bool{
		"oil_vessels": true, "oil_companies": true,
		"licenses": true, "oil_terminals": true, "petroleum_osm_features": true,
		"oil_port_calls": true, "oil_sts_events": true,
		"eia_historic_imports": true, "oil_commercial_events": true,
		"oil_company_contacts": true, "broker_deal_packs": true,
		"oil_intelligence_cards": true, "entity_relationships": true,
	}
	for _, spec := range catalog {
		if !want[spec.LegacyTable] {
			t.Fatalf("unexpected table %q", spec.LegacyTable)
		}
		if spec.LegacyCountSQL == "" || spec.MadsanCountSQL == "" {
			t.Fatalf("missing SQL for %q", spec.LegacyTable)
		}
	}
	for _, spec := range catalog {
		if spec.LegacyTable == "licenses" && !strings.Contains(spec.LegacyCountSQL, "DISTINCT") {
			t.Fatal("licenses parity must use distinct importable keys, not raw row count")
		}
	}
}

func TestLicenseTierSQLDefined(t *testing.T) {
	if licenseTierSQL == "" {
		t.Fatal("licenseTierSQL must be defined")
	}
	for _, col := range []string{
		"legacy_total", "not_importable_no_coords", "import_pool_geocoded",
		"expected_skip_empty_name", "expected_dedup_keys",
	} {
		if !strings.Contains(licenseTierSQL, col) {
			t.Fatalf("licenseTierSQL missing %q", col)
		}
	}
}

func TestLicenseImportTiersJSON(t *testing.T) {
	tiers := LicenseImportTiers{
		LegacyTotal: 75671, NotImportableNoCoords: 2559, ImportPoolGeocoded: 73112,
		ExpectedSkipEmptyName: 0, ExpectedDedupKeys: 45506, UnderImportGap: 3,
	}
	report := ParityReport{
		Passed: true, ThresholdPct: 5,
		Tables: []ParityTableResult{{
			LegacyTable: "licenses", MadsanTarget: "assets(legacy_licenses)",
			LegacyCount: 45506, MadsanCount: 45503, Drift: -3, DriftPct: 0.01,
			Critical: true, OK: true, LicenseTiers: &tiers,
		}},
	}
	out, err := ParityReportJSON(report)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), "license_tiers") {
		t.Fatal("expected license_tiers in JSON")
	}
	if !strings.Contains(string(out), "under_import_gap") {
		t.Fatal("expected under_import_gap in JSON")
	}
}

func TestTerminalTierSQLDefined(t *testing.T) {
	if terminalTierSQL == "" {
		t.Fatal("terminalTierSQL must be defined")
	}
	for _, col := range []string{
		"legacy_total", "not_importable_no_geom", "import_pool_geocoded",
		"expected_skip_empty_name", "name_dedup_keys",
	} {
		if !strings.Contains(terminalTierSQL, col) {
			t.Fatalf("terminalTierSQL missing %q", col)
		}
	}
}

func TestParityReportJSON(t *testing.T) {
	report := ParityReport{
		Passed:       true,
		ThresholdPct: 5,
		Tables: []ParityTableResult{{
			LegacyTable: "oil_vessels", MadsanTarget: "vessels",
			LegacyCount: 100, MadsanCount: 98, Drift: -2, DriftPct: 2, Critical: true, OK: true,
		}},
	}
	out, err := ParityReportJSON(report)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) == 0 {
		t.Fatal("empty json")
	}
}
