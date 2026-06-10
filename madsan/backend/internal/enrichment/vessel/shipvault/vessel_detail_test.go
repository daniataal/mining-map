package shipvault

import "testing"

func TestParseVesselDetail_dimensions(t *testing.T) {
	t.Parallel()
	raw := map[string]any{
		"id": "v1", "imo": 9304605, "name": "TEST",
		"lengthM": 250.5, "beamM": 44, "depthM": 22.1, "draftM": 15.3,
		"netTonnage": 42000, "enginePowerHp": 12000, "teu": 4500,
		"grainCapacity": 98000, "baleCapacity": 87000,
		"propulsion": "Diesel", "yard_id": "yard-9", "builder": "Hyundai",
		"yard_no": "HN-42", "disponentName": "ACME NAV",
	}
	d := parseVesselDetail(raw, "9304605")
	if d.LengthM != 250.5 || d.BeamM != 44 || d.DepthM != 22.1 || d.DraftM != 15.3 || d.NetTonnage != 42000 {
		t.Fatalf("dims = %#v", d)
	}
	if d.EnginePowerHP != 12000 || d.EnginePowerKW <= 0 {
		t.Fatalf("engine = hp %v kw %v", d.EnginePowerHP, d.EnginePowerKW)
	}
	if d.CapacityTEU != 4500 || d.CapacityGrain != 98000 || d.CapacityBale != 87000 {
		t.Fatalf("capacities = teu %v grain %v bale %v", d.CapacityTEU, d.CapacityGrain, d.CapacityBale)
	}
	if d.YardID != "yard-9" || d.YardName != "Hyundai" || d.YardNumber != "HN-42" {
		t.Fatalf("yard = %q %q %q", d.YardID, d.YardName, d.YardNumber)
	}
	if d.Disponent != "ACME NAV" {
		t.Fatalf("disponent = %q", d.Disponent)
	}
	spec := d.TechnicalSpecs()
	if spec.LengthM != 250.5 || spec.CapacityTEU != 4500 {
		t.Fatalf("specs = %#v", spec)
	}
}

func TestMergeNameHistoryFromEvents(t *testing.T) {
	t.Parallel()
	v := &VesselProfile{NameHistory: []NameHistoryEntry{{Name: "ALPHA"}}}
	events := []map[string]any{
		{"type": "rename", "name": "BETA", "from_date": "2020", "disponent": "ACME NAV"},
	}
	mergeNameHistoryFromEvents(v, events)
	if len(v.NameHistory) != 2 {
		t.Fatalf("history len = %d", len(v.NameHistory))
	}
	if v.NameHistory[1].Disponent != "ACME NAV" {
		t.Fatalf("disponent = %q", v.NameHistory[1].Disponent)
	}
}
