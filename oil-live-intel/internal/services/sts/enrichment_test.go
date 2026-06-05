package sts

import (
	"testing"
	"time"
)

func TestComputeEnrichmentStatus(t *testing.T) {
	const mmsiA, mmsiB int64 = 111, 222

	tests := []struct {
		name  string
		port  []LinkedPortCall
		cargo []CargoHypothesis
		want  string
	}{
		{"none", nil, nil, EnrichmentNone},
		{"partial one port call", []LinkedPortCall{{MMSI: mmsiA}}, nil, EnrichmentPartial},
		{"partial one cargo", nil, []CargoHypothesis{{MMSI: mmsiB}}, EnrichmentPartial},
		{"linked both port calls", []LinkedPortCall{{MMSI: mmsiA}, {MMSI: mmsiB}}, nil, EnrichmentLinked},
		{"linked both cargo", nil, []CargoHypothesis{{MMSI: mmsiA}, {MMSI: mmsiB}}, EnrichmentLinked},
		{"linked mixed", []LinkedPortCall{{MMSI: mmsiA}}, []CargoHypothesis{{MMSI: mmsiB}}, EnrichmentLinked},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ComputeEnrichmentStatus(tc.port, tc.cargo, mmsiA, mmsiB)
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestPortCallOverlaps(t *testing.T) {
	from := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 1, 20, 0, 0, 0, 0, time.UTC)
	arrival := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)
	departure := time.Date(2026, 1, 16, 0, 0, 0, 0, time.UTC)
	early := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	if !portCallOverlaps(portCallRow{ArrivalTS: &arrival, DepartureTS: &departure}, from, to) {
		t.Fatal("expected overlap")
	}
	if portCallOverlaps(portCallRow{ArrivalTS: &early, DepartureTS: &early}, from, to) {
		t.Fatal("expected no overlap")
	}
}

func TestParseVerificationMeta(t *testing.T) {
	if ParseVerificationMeta("inferred", map[string]any{"verified_by": "x"}) != nil {
		t.Fatal("inferred should not expose verification")
	}
	vm := ParseVerificationMeta("verified", map[string]any{
		"verified_by":        "analyst@example.com",
		"verification_notes": "confirmed via satellite",
		"verified_at":        "2026-06-01T12:00:00Z",
	})
	if vm == nil || vm.VerifiedBy != "analyst@example.com" || vm.VerificationNotes != "confirmed via satellite" {
		t.Fatalf("unexpected vm %#v", vm)
	}
}

func TestInferPortCallProvenance(t *testing.T) {
	if got := inferPortCallProvenance([]byte(`["seed_port_calls"]`), nil); got != "seed_port_calls" {
		t.Fatalf("got %q", got)
	}
	if got := inferPortCallProvenance([]byte(`live_ais`), nil); got != "live_ais" {
		t.Fatalf("got %q", got)
	}
}
