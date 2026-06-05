package sts

import (
	"testing"
	"time"
)

func TestDefaultDetectConfig_RetainHours(t *testing.T) {
	cfg := DefaultDetectConfig(48)
	if cfg.MaxDistanceM != DefaultMaxDistanceM {
		t.Fatalf("max distance %v", cfg.MaxDistanceM)
	}
	if cfg.PositionsTable != "oil_ais_positions" {
		t.Fatalf("table %s", cfg.PositionsTable)
	}
	if cfg.WindowEnd.Sub(cfg.WindowStart) != 48*time.Hour {
		t.Fatalf("window %v", cfg.WindowEnd.Sub(cfg.WindowStart))
	}
}

func TestIsTanker(t *testing.T) {
	if !isTanker("crude") {
		t.Fatal("crude should be tanker")
	}
	if isTanker("unknown") || isTanker("") {
		t.Fatal("unknown/empty should not be tanker")
	}
}

func TestArchiveDetectConfig(t *testing.T) {
	cfg := ArchiveDetectConfig(7)
	if cfg.PositionsTable != "oil_ais_track_points" {
		t.Fatalf("table %s", cfg.PositionsTable)
	}
	if cfg.SpeedColumn != "sog" {
		t.Fatalf("speed column %s", cfg.SpeedColumn)
	}
}

func TestDedupeCandidates_overlap(t *testing.T) {
	start := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	live := Candidate{MMSIA: 1, MMSIB: 2, StartTS: start, EndTS: start.Add(3 * time.Hour), MinDistanceM: 200}
	archive := Candidate{MMSIA: 1, MMSIB: 2, StartTS: start.Add(30 * time.Minute), EndTS: start.Add(4 * time.Hour), MinDistanceM: 150}
	out := dedupeCandidates([]Candidate{live, archive})
	if len(out) != 1 {
		t.Fatalf("deduped len %d", len(out))
	}
	if out[0].MinDistanceM != 150 {
		t.Fatalf("min distance %v", out[0].MinDistanceM)
	}
}
