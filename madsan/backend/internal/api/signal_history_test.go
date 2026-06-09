package api

import (
	"encoding/json"
	"testing"
	"time"
)

func TestEnrichSTSSignalHistory(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{
		"min_distance_m": 150.0, "duration_hours": 4.0, "avg_sog": 0.4,
		"both_tankers": true, "in_sts_zone": true, "outside_terminal": true,
		"zone_name": "Fujairah STS anchorage (approx)",
	})
	entry := SignalHistoryEntry{SignalType: "sts", Tier: "observed", ConfidenceScore: 0}
	enrichSTSSignalHistory(&entry, payload, 0)
	if entry.Tier != "observed" {
		t.Fatalf("tier=%s want observed", entry.Tier)
	}
	if len(entry.STSFactors) != 6 {
		t.Fatalf("expected 6 factors, got %d", len(entry.STSFactors))
	}
	if entry.ConfidenceScore < 60 {
		t.Fatalf("expected meaningful score, got %.0f", entry.ConfidenceScore)
	}
}

func TestMergeSignalHistory(t *testing.T) {
	a := []SignalHistoryEntry{{SignalType: "ais_position_update", ObservedAt: parseTestTime(t, "2026-06-01T10:00:00Z")}}
	b := []SignalHistoryEntry{{SignalType: "sts", ObservedAt: parseTestTime(t, "2026-06-02T10:00:00Z")}}
	merged := mergeSignalHistory(a, b, 5)
	if len(merged) != 2 || merged[0].SignalType != "sts" {
		t.Fatalf("expected sts first, got %+v", merged)
	}
}

func parseTestTime(t *testing.T, s string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return ts
}
