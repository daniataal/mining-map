package ingestion

import "testing"

func TestStripGEMOwnershipPct(t *testing.T) {
	got := stripGEMOwnershipPct("Europe Asia Pipeline Company Ltd [100.00%]")
	want := "Europe Asia Pipeline Company Ltd"
	if got != want {
		t.Fatalf("stripGEMOwnershipPct = %q, want %q", got, want)
	}
}

func TestParseGEMPipelineCommercial(t *testing.T) {
	raw := map[string]any{
		"Owner":          "Acme Pipelines [50.00%]",
		"Parent":         "Acme Global",
		"Fuel":           "Oil",
		"Status":         "operating",
		"Capacity":       "500000",
		"CapacityUnits":  "bbl/d",
		"LengthMergedKm": "254",
		"Wiki":           "https://example.org/pipeline",
		"OwnerEntityIDs": "E-123",
		"segment_key":    "P0549:175",
	}
	c := parseGEMPipelineCommercial(raw, nil)
	if c.OwnerName != "Acme Pipelines" {
		t.Fatalf("OwnerName = %q", c.OwnerName)
	}
	if c.ParentName != "Acme Global" {
		t.Fatalf("ParentName = %q", c.ParentName)
	}
	if c.Fuel != "Oil" || c.Status != "operating" {
		t.Fatalf("Fuel/Status = %q / %q", c.Fuel, c.Status)
	}
	if c.CapacityText != "500000 bbl/d" {
		t.Fatalf("CapacityText = %q", c.CapacityText)
	}
	if c.LengthKm == nil || *c.LengthKm != 254 {
		t.Fatalf("LengthKm = %v", c.LengthKm)
	}
	if c.WikiURL == "" || c.OwnerEntityIDs != "E-123" {
		t.Fatalf("Wiki/IDs missing")
	}
}

func TestParseGEMPipelineCommercialFromTags(t *testing.T) {
	tags := map[string]any{
		"owner":  "Netherlands Gas Transport BV [100.00%]",
		"parent": "Gasunie",
		"fuel":   "NGL",
		"status": "operating",
	}
	c := parseGEMPipelineCommercial(nil, tags)
	if c.OwnerName != "Netherlands Gas Transport BV" {
		t.Fatalf("OwnerName = %q", c.OwnerName)
	}
	if c.ParentName != "Gasunie" {
		t.Fatalf("ParentName = %q", c.ParentName)
	}
}
