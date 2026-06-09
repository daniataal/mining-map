package ingestion

import "testing"

func TestLegacyParityCatalog(t *testing.T) {
	catalog := LegacyParityCatalog()
	if len(catalog) != 4 {
		t.Fatalf("expected 4 tables, got %d", len(catalog))
	}
	want := map[string]bool{
		"oil_vessels": true, "oil_companies": true,
		"licenses": true, "petroleum_osm_features": true,
	}
	for _, spec := range catalog {
		if !want[spec.LegacyTable] {
			t.Fatalf("unexpected table %q", spec.LegacyTable)
		}
		if spec.LegacyCountSQL == "" || spec.MadsanCountSQL == "" {
			t.Fatalf("missing SQL for %q", spec.LegacyTable)
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
