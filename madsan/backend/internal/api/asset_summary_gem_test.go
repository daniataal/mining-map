package api

import "testing"

func TestEnrichGemPipelineSummary(t *testing.T) {
	raw := map[string]any{
		"Owner":            "Acme Pipelines [100.00%]",
		"Parent":           "Acme Global",
		"Fuel":             "Oil",
		"Status":           "operating",
		"Capacity":         "500000",
		"CapacityUnits":    "bbl/d",
		"LengthMergedKm":   "254",
		"Wiki":             "https://example.org/pipeline",
		"ProposalYear":     "1960",
		"StartYear1":       "1968",
		"StartYear2":       "1970",
		"FuelSource":       "Iran",
		"LastUpdated":      "2025-02-03",
	}
	summary := map[string]any{"asset_type": "pipeline"}
	enrichGemPipelineSummary(summary, "pipeline", raw)
	if summary["start_years"] != "1968, 1970" {
		t.Fatalf("start_years = %v", summary["start_years"])
	}
	if summary["fuel_source"] != "Iran" {
		t.Fatalf("fuel_source = %v", summary["fuel_source"])
	}
	if summary["gem_last_updated"] != "2025-02-03" {
		t.Fatalf("gem_last_updated = %v", summary["gem_last_updated"])
	}
}
