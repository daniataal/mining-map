package shipvault

import "testing"

func TestParseVesselDetail_dimensions(t *testing.T) {
	t.Parallel()
	raw := map[string]any{
		"id": "v1", "imo": 9304605, "name": "TEST",
		"lengthM": 250.5, "beamM": 44, "netTonnage": 42000,
		"propulsion": "Diesel", "yard_id": "yard-9", "builder": "Hyundai",
	}
	d := parseVesselDetail(raw, "9304605")
	if d.LengthM != 250.5 || d.BeamM != 44 || d.NetTonnage != 42000 {
		t.Fatalf("dims = %#v", d)
	}
	if d.YardID != "yard-9" || d.YardName != "Hyundai" {
		t.Fatalf("yard = %q %q", d.YardID, d.YardName)
	}
}
