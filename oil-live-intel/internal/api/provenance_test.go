package api

import "testing"

func TestInferPortCallProvenance(t *testing.T) {
	meta := []byte(`{"source":"live_ais"}`)
	if got := inferPortCallProvenance(nil, meta); got != "live_ais" {
		t.Fatalf("metadata: got %q", got)
	}
	seed := []byte(`[{"source":"seed_port_calls","pattern":"export_hub_load"}]`)
	if got := inferPortCallProvenance(seed, nil); got != "seed_port_calls" {
		t.Fatalf("seed evidence: got %q", got)
	}
	demo := []byte(`["DEMO SEED — synthetic AIS-style port call"]`)
	if got := inferPortCallProvenance(demo, nil); got != "synthetic" {
		t.Fatalf("demo: got %q", got)
	}
	live := []byte(`["Inferred from public AIS — not a confirmed private transaction"]`)
	if got := inferPortCallProvenance(live, nil); got != "live_ais" {
		t.Fatalf("live ais evidence: got %q", got)
	}
}

func TestCargoRecordIsSeed(t *testing.T) {
	seedPC := []byte(`[{"source":"seed_port_calls"}]`)
	if !cargoRecordIsSeed(nil, seedPC, nil) {
		t.Fatal("expected seed from port call evidence")
	}
	meta := []byte(`{"source":"seed_port_calls"}`)
	if !cargoRecordIsSeed(nil, nil, meta) {
		t.Fatal("expected seed from port call metadata")
	}
	mcrEv := []byte(`["seed_port_calls corridor"]`)
	if !cargoRecordIsSeed(mcrEv, nil, nil) {
		t.Fatal("expected seed from mcr evidence")
	}
	live := []byte(`{"source":"live_ais"}`)
	if cargoRecordIsSeed(nil, nil, live) {
		t.Fatal("live_ais should not be seed")
	}
}

func TestInferCargoProvenance(t *testing.T) {
	if inferCargoProvenance("") != "synthetic" {
		t.Fatal("empty tier")
	}
	if inferCargoProvenance("synthetic") != "synthetic" {
		t.Fatal("synthetic tier")
	}
}

func TestParseBBox(t *testing.T) {
	minLon, minLat, maxLon, maxLat, ok := parseBBox("-1,50,5,55")
	if !ok || minLon != -1 || minLat != 50 || maxLon != 5 || maxLat != 55 {
		t.Fatalf("bbox parse failed: %v %v %v %v %v", minLon, minLat, maxLon, maxLat, ok)
	}
	_, _, _, _, bad := parseBBox("bad")
	if bad {
		t.Fatal("expected invalid bbox")
	}
}
