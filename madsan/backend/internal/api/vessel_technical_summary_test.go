package api

import (
	"testing"
)

func TestMergeVesselTechnicalSummaryFromRaw(t *testing.T) {
	t.Parallel()
	raw := []byte(`{
		"vessel_specs": {
			"build_year": 2006,
			"vessel_class": "CRUDE OIL TANKER",
			"gross_tonnage": 83722,
			"deadweight_tons": 159450,
			"length_m": 274.2,
			"beam_m": 48,
			"propulsion": "Diesel",
			"engine_power_kw": 18600,
			"capacity_grain": 120000,
			"status": "ACTIVE"
		},
		"estimated_value_usd": 37377989,
		"name_history": [{"name": "LEON", "from_date": "2010"}]
	}`)
	summary := map[string]any{"mmsi": "636019825"}
	year := 2006
	mergeVesselTechnicalSummary(summary, "Hyundai", &year, raw)

	if summary["build_year"] != 2006 {
		t.Fatalf("build_year = %v", summary["build_year"])
	}
	if summary["vessel_class"] != "CRUDE OIL TANKER" {
		t.Fatalf("vessel_class = %v", summary["vessel_class"])
	}
	if summary["length_m"] != 274.2 {
		t.Fatalf("length_m = %v", summary["length_m"])
	}
	if summary["vessel_status"] != "ACTIVE" {
		t.Fatalf("vessel_status = %v", summary["vessel_status"])
	}
	if summary["estimated_value_usd"] != float64(37377989) {
		t.Fatalf("estimated_value_usd = %v", summary["estimated_value_usd"])
	}
	hist, ok := summary["name_history"].([]any)
	if !ok || len(hist) != 1 {
		t.Fatalf("name_history = %#v", summary["name_history"])
	}
}
