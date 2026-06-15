package ingestion

import "testing"

func TestTerminalTypeToAssetType(t *testing.T) {
	cases := map[string]string{
		"storage_tank":     "tank_farm",
		"tank_farm":        "tank_farm",
		"storage_terminal": "terminal",
		"refinery":         "refinery",
		"berth":            "terminal",
		"":                 "terminal",
	}
	for terminalType, want := range cases {
		if got := TerminalTypeToAssetType(terminalType); got != want {
			t.Fatalf("%q: got %q want %q", terminalType, got, want)
		}
	}
}

func TestNormalizeLegacyRowOilTerminals(t *testing.T) {
	row := map[string]any{
		"id":            "abc-123",
		"name":          "Fujairah Oil Terminal",
		"terminal_type": "storage_terminal",
		"operator_name": "VTTI",
		"owner_name":    "VTTI Group",
		"country":       "AE",
		"products":      []any{"crude", "products"},
		"confidence":    0.85,
		"latitude":      25.12,
		"longitude":     56.35,
	}
	spec := legacyTableSpec{Table: "oil_terminals", EntityType: "asset"}
	rec := normalizeLegacyRow(spec, row)
	if rec.AssetType != "terminal" {
		t.Fatalf("asset_type = %q, want terminal", rec.AssetType)
	}
	if rec.Name != "Fujairah Oil Terminal" {
		t.Fatalf("name = %q", rec.Name)
	}
	if rec.CountryCode != "AE" {
		t.Fatalf("country = %q", rec.CountryCode)
	}
	if rec.RawPayload["operator_name"] != "VTTI" {
		t.Fatalf("operator_name = %v", rec.RawPayload["operator_name"])
	}
	if op := operatorNameFromRecord(rec); op != "VTTI" {
		t.Fatalf("operatorNameFromRecord = %q", op)
	}
}

func TestReconcileTerminalFromTags(t *testing.T) {
	tags := map[string]any{
		"operator": "Shell",
		"capacity": "120000",
	}
	result := ReconcileTerminalFromTags("Test Tank Farm", tags)
	if result.OperatorName != "Shell" {
		t.Fatalf("operator = %q", result.OperatorName)
	}
	if result.CapacityVal == nil || *result.CapacityVal != 120000 {
		t.Fatalf("capacity = %v", result.CapacityVal)
	}
	if result.Tier != "observed" {
		t.Fatalf("tier = %q, want observed", result.Tier)
	}
}

func TestNamesSimilar(t *testing.T) {
	if !namesSimilar("Fujairah Oil Terminal", "Fujairah Oil Terminal Hub") {
		t.Fatal("expected similar names")
	}
	if namesSimilar("Alpha", "Beta") {
		t.Fatal("expected dissimilar names")
	}
}
