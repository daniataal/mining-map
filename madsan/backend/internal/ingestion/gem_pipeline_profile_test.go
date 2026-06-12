package ingestion

import "testing"

func TestGemJoinStartYears(t *testing.T) {
	raw := map[string]any{"StartYear1": "1968", "StartYear2": "1970", "StartYear3": "1970"}
	got := gemJoinStartYears(raw, nil)
	want := "1968, 1970"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestBuildGEMPipelineProfile(t *testing.T) {
	raw := map[string]any{
		"Status":          "operating",
		"Owner":           "Acme [100%]",
		"Parent":          "Acme Global",
		"ProposalYear":    "1960",
		"ConstructionYear": "1965",
		"StartYear1":      "1968",
		"Diameter":        "42",
		"DiameterUnits":   "in",
		"DelayType":       "confirmed",
		"FuelSource":      "Permian Basin",
		"StartLocation":   "Point A",
		"StartCountry":    "USA",
		"StartRegion":     "North America",
		"EndLocation":     "Point B",
		"EndCountry":      "USA",
		"CostUSD":         "1.2B",
		"LastUpdated":     "2025-02-03",
		"OtherLanguagePrimaryPipelineName": "צינור",
		"Capacity":        "500000",
		"CapacityUnits":   "bbl/d",
	}
	p := BuildGEMPipelineProfile(raw, nil)
	if p["start_years"] != "1968" {
		t.Fatalf("start_years=%q", p["start_years"])
	}
	if p["delay_note"] == "" {
		t.Fatal("expected delay_note for operating + confirmed")
	}
	if p["fuel_source"] != "Permian Basin" {
		t.Fatalf("fuel_source=%q", p["fuel_source"])
	}
	if p["cost"] != "1.2B USD" {
		t.Fatalf("cost=%q", p["cost"])
	}
	if p["language"] != "צינור" {
		t.Fatalf("language=%q", p["language"])
	}
}
