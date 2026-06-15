package api

import "testing"

func TestBuildCommercialChainBundleIncludesInfrastructureAndCoverage(t *testing.T) {
	bundle := buildCommercialChainBundle(commercialChainBundleInput{
		EntityType:  "asset",
		EntityID:    "asset-1",
		Name:        "Fujairah Oil Industry Zone",
		CountryCode: "UNITED ARAB EMIRATES",
		AssetType:   "terminal",
		Operator:    map[string]any{"company_id": "company-1", "name": "Fujairah Oil Terminal / VTTI"},
		Infrastructure: []map[string]any{
			{"asset_id": "tank-1", "name": "Nearby tank farm", "asset_type": "tank_farm", "distance_km": 5.8, "evidence_label": "reported"},
		},
		CoverageContext: map[string]any{"port_call_visits": 0, "ais_positions_7d": 0},
		CoverageGaps: []string{
			"No exact port-call visits are attached to this asset yet.",
		},
		LinkedIntel: map[string]any{},
	})

	steps := commercialRecordArray(bundle["chain_steps"])
	if len(steps) != 3 {
		t.Fatalf("chain_steps len = %d, want 3: %#v", len(steps), steps)
	}
	if steps[2]["step"] != "nearby_infrastructure" {
		t.Fatalf("expected nearby infrastructure step, got %#v", steps[2])
	}
	infra := commercialRecordArray(bundle["infrastructure_context"])
	if len(infra) != 1 {
		t.Fatalf("infrastructure_context len = %d, want 1", len(infra))
	}
	limitations := commercialStringArray(bundle["limitations"])
	if len(limitations) == 0 || limitations[0] != "No exact port-call visits are attached to this asset yet." {
		t.Fatalf("limitations missing coverage gap: %#v", limitations)
	}
	coverage := commercialRecord(bundle["coverage_context"])
	if coverage["ais_positions_7d"] == nil {
		t.Fatalf("coverage_context missing ais_positions_7d: %#v", coverage)
	}
}
