package ingestion

import "testing"

func TestGEMPipelineCuratedFuelSourceTransIsrael(t *testing.T) {
	raw := map[string]any{
		"FuelSource":  "Iran",
		"segment_key": "P0549:175",
		"ProjectID":   "P0549",
		"Status":      "operating",
	}
	p := BuildGEMPipelineProfile(raw, nil)
	if p["fuel_source"] != "Kazakhstan, UAE, Azerbaijan" {
		t.Fatalf("fuel_source = %q", p["fuel_source"])
	}
}
