package api

import ("testing"; "time")

func TestBuildEntityEnvelopeAsset(t *testing.T) {
	obs := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	resp := CoreEntityResponse{ID: "x", EntityType: "asset", Confidence: ConfidenceBlock{Score: 72}, SignalHistory: []SignalHistoryEntry{{ObservedAt: obs}}}
	env := buildEntityEnvelope(resp, 3, &obs, nil)
	if env.Tier != "inferred" { t.Fatalf("%+v", env) }
}

func TestVesselEntityTier(t *testing.T) {
	fresh := time.Now().Add(-2 * time.Hour)
	if vesselEntityTier(&fresh, 0) != "observed" { t.Fatal("want observed") }
}
