package api

import (
	"strings"
	"testing"
)

func TestMatchVesselInFleetListUsesIMOFirst(t *testing.T) {
	raw := []byte(`[
		{"imo":"9482627","mmsi":"538004100","name":"SEA JAGUAR","type":"Crude Oil Tanker"},
		{"imo":"9876543","name":"OTHER"}
	]`)

	match := matchVesselInFleetList(raw, "000000000", "9482627", nil)
	if !match.Matched || match.MatchBy != "imo" || match.Name != "SEA JAGUAR" {
		t.Fatalf("unexpected match: %#v", match)
	}
}

func TestMatchVesselInFleetListUsesNameHistory(t *testing.T) {
	raw := []byte(`[{"name":"Phoenix Advance","type":"Crude Oil Tanker"}]`)
	names := []map[string]any{{"name": "PHOENIX-ADVANCE"}}

	match := matchVesselInFleetList(raw, "", "", names)
	if !match.Matched || match.MatchBy != "name_history" {
		t.Fatalf("expected name-history match, got %#v", match)
	}
}

func TestBuildVesselOwnershipIntelHighWithFleetEvidence(t *testing.T) {
	summary := map[string]any{
		"imo":           "9482627",
		"mmsi":          "538004100",
		"owner_name":    "Pantheon Tankers Management",
		"operator_name": "Pantheon Tankers Management",
		"name_history": []map[string]any{
			{"name": "Phoenix Advance", "disponent": "Old Tankers SA", "from_date": "2014"},
		},
	}
	ownerProfile := map[string]any{
		"shipvault_company_id": "co-1",
		"name":                 "Pantheon Tankers Management",
		"parent_name":          "Pantheon Shipping Group",
		"fleet_size":           28,
		"madsan_company_id":    "1b5e69bc-33f8-4394-a6a7-c78e3a84a001",
	}

	intel := buildVesselOwnershipIntel(summary, ownerProfile, vesselFleetMatch{
		Matched: true, MatchBy: "imo", MatchValue: "9482627", Name: "SEA JAGUAR",
	})
	if intel["tier"] != "high" {
		t.Fatalf("tier = %v, intel=%#v", intel["tier"], intel)
	}
	if intel["beneficial_owner_status"] != "candidate_owner_chain" {
		t.Fatalf("status = %v", intel["beneficial_owner_status"])
	}
	history := intel["history_candidates"].([]map[string]any)
	if len(history) != 1 || history[0]["disponent"] != "Old Tankers SA" {
		t.Fatalf("history candidates = %#v", history)
	}
	chain := intel["role_chain"].([]map[string]any)
	foundParent := false
	for _, row := range chain {
		if row["role"] == "parent_or_group" && row["label"] == "Pantheon Shipping Group" {
			foundParent = true
		}
	}
	if !foundParent {
		t.Fatalf("expected parent chain row, got %#v", chain)
	}
	pivots := intel["search_pivots"].([]string)
	foundPreviousNamePivot := false
	foundDisponentPivot := false
	for _, pivot := range pivots {
		if strings.Contains(pivot, "Phoenix Advance") && strings.Contains(pivot, "sold purchased") {
			foundPreviousNamePivot = true
		}
		if strings.Contains(pivot, "Old Tankers SA") && strings.Contains(pivot, "vessel owner operator") {
			foundDisponentPivot = true
		}
	}
	if !foundPreviousNamePivot || !foundDisponentPivot {
		t.Fatalf("expected previous-name sale pivot, got %v", pivots)
	}
}

func TestBuildVesselOwnershipIntelFlagsOneVesselRegisteredOwner(t *testing.T) {
	intel := buildVesselOwnershipIntel(
		map[string]any{"imo": "9482627", "owner_name": "Cobalt Navigation SA"},
		map[string]any{"shipvault_company_id": "co-1", "fleet_size": 1},
		vesselFleetMatch{},
	)
	if intel["beneficial_owner_status"] != "registered_owner_only" {
		t.Fatalf("expected registered_owner_only, got %#v", intel)
	}
	limitations := intel["limitations"].([]string)
	if len(limitations) == 0 || !strings.Contains(limitations[0], "one-vessel registered owner") {
		t.Fatalf("expected one-vessel limitation, got %v", limitations)
	}
}
