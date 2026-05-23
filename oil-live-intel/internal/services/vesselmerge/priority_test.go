package vesselmerge

import (
	"testing"
	"time"
)

func TestPetroleumPriorityScore(t *testing.T) {
	code := 82
	if PetroleumPriorityScore(&code, "Tanker", "", nil, nil) <= PetroleumPriorityScore(nil, "Cargo", "", nil, nil) {
		t.Fatal("tanker AIS code should outrank cargo label")
	}
	crude := true
	if PetroleumPriorityScore(nil, "", "", &crude, nil) < 100 {
		t.Fatal("crude_capable should score 100")
	}
	if ShipTypeCategory(&code, "Tanker", "", nil, nil) != "tanker" {
		t.Fatalf("expected tanker category, got %q", ShipTypeCategory(&code, "Tanker", "", nil, nil))
	}
}

func TestApplyPetroleumCapPrioritizesTankers(t *testing.T) {
	now := time.Now()
	vessels := []map[string]any{
		{"mmsi": int64(1), "position_time": now.Add(-time.Hour), "ship_type_label": "Cargo"},
		{"mmsi": int64(2), "position_time": now, "ship_type_code": 82, "ship_type_label": "Tanker"},
		{"mmsi": int64(3), "position_time": now, "ship_type_label": "Fishing"},
	}
	result := applyPetroleumCap(vessels, 2, "test")
	if !result.CapApplied {
		t.Fatal("expected cap_applied")
	}
	if result.TotalAvailable != 3 || result.ReturnedCount != 2 {
		t.Fatalf("unexpected counts total=%d returned=%d", result.TotalAvailable, result.ReturnedCount)
	}
	if result.Vessels[0]["mmsi"] != int64(2) {
		t.Fatalf("expected tanker first, got %#v", result.Vessels[0]["mmsi"])
	}
	if result.ShipTypeCounts["tanker"] != 1 {
		t.Fatalf("expected one tanker in full bbox counts, got %#v", result.ShipTypeCounts)
	}
}
