package ingestion

import "testing"

func TestVesselMMSI(t *testing.T) {
	raw := map[string]any{"mmsi": float64(431003736), "imo": "9634012"}
	if got := vesselMMSI(raw); got != "431003736" {
		t.Fatalf("got %q", got)
	}
}

func TestMapLegacyRecordVessel(t *testing.T) {
	m := map[string]any{
		"entity_type": "vessel",
		"name":        "TEST SHIP",
		"latitude":    "34.05",
		"longitude":   "132.65",
		"mmsi":        "431003736",
		"raw_payload": map[string]any{"mmsi": float64(431003736), "imo": "9634012", "vessel_type": "Tanker"},
	}
	rec := mapLegacyRecord(m, "legacy_oil_vessels")
	if rec.EntityType != "vessel" {
		t.Fatalf("entity_type %q", rec.EntityType)
	}
	if rec.Latitude == nil || rec.Longitude == nil {
		t.Fatal("coords missing")
	}
	if vesselMMSI(rec.RawPayload) == "" {
		t.Fatal("mmsi missing")
	}
}
