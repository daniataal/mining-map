package shipvault

import "testing"

func TestParseVesselDetail_dimensions(t *testing.T) {
	t.Parallel()
	raw := map[string]any{
		"id": "v1", "imo": 9304605, "name": "TEST",
		"lengthM": 250.5, "beamM": 44, "netTonnage": 42000,
		"propulsion": "Diesel", "yard_id": "yard-9", "builder": "Hyundai",
		"yard_no": "HN-42",
	}
	d := parseVesselDetail(raw, "9304605")
	if d.LengthM != 250.5 || d.BeamM != 44 || d.NetTonnage != 42000 {
		t.Fatalf("dims = %#v", d)
	}
	if d.YardID != "yard-9" || d.YardName != "Hyundai" || d.YardNumber != "HN-42" {
		t.Fatalf("yard = %q %q %q", d.YardID, d.YardName, d.YardNumber)
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
