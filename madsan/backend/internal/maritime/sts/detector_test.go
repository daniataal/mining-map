package sts

import (
	"testing"
	"time"
)

func TestDedupeCandidatesOverlap(t *testing.T) {
	base := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	in := []Candidate{
		{MMSIA: "111", MMSIB: "222", StartTS: base, EndTS: base.Add(3 * time.Hour), MinDistanceM: 200},
		{MMSIA: "111", MMSIB: "222", StartTS: base.Add(2 * time.Hour), EndTS: base.Add(5 * time.Hour), MinDistanceM: 150},
	}
	out := dedupeCandidates(in)
	if len(out) != 1 {
		t.Fatalf("expected 1 merged candidate, got %d", len(out))
	}
	if out[0].MinDistanceM != 150 {
		t.Fatalf("expected min distance 150, got %v", out[0].MinDistanceM)
	}
}

func TestIsTanker(t *testing.T) {
	if !isTanker("crude") {
		t.Fatal("crude should be tanker")
	}
	if isTanker("container") {
		t.Fatal("container should not be tanker")
	}
}
