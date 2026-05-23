package vesselmerge

import (
	"testing"
	"time"
)

func TestSourceRankPrecedence(t *testing.T) {
	if SourceRank("live_ais") >= SourceRank("aisstream") {
		t.Fatal("live_ais should outrank aisstream")
	}
	if SourceRank("aisstream_snapshot") >= SourceRank("maritime_redis") {
		t.Fatal("aisstream_snapshot should outrank maritime_redis")
	}
	if SourceRank("maritime_redis") >= SourceRank("inferred_port_call") {
		t.Fatal("maritime_redis should outrank inferred_port_call")
	}
}

func TestClampLimit(t *testing.T) {
	if ClampLimit(0) != defaultVesselLimit {
		t.Fatalf("zero -> default, got %d", ClampLimit(0))
	}
	if ClampLimit(-5) != defaultVesselLimit {
		t.Fatalf("negative -> default, got %d", ClampLimit(-5))
	}
	if ClampLimit(100) != 100 {
		t.Fatalf("in-range unchanged, got %d", ClampLimit(100))
	}
	if ClampLimit(99999) != maxVesselLimit {
		t.Fatalf("over max capped, got %d", ClampLimit(99999))
	}
	if ClampLimitWithMax(3000, 2000) != 2000 {
		t.Fatalf("ClampLimitWithMax should cap at max, got %d", ClampLimitWithMax(3000, 2000))
	}
	if ClampLimitWithMax(100, 2000) != 100 {
		t.Fatalf("ClampLimitWithMax should not raise under max, got %d", ClampLimitWithMax(100, 2000))
	}
}

func TestVesselIdentityKeyPrefersIMO(t *testing.T) {
	imo := " 9876543 "
	if got := VesselIdentityKey(123456789, &imo); got != "imo:9876543" {
		t.Fatalf("expected imo key, got %q", got)
	}
}

func TestVesselIdentityKeyFallsBackToMMSI(t *testing.T) {
	if got := VesselIdentityKey(636023100, nil); got != "mmsi:636023100" {
		t.Fatalf("expected mmsi key, got %q", got)
	}
	empty := "   "
	if got := VesselIdentityKey(636023100, &empty); got != "mmsi:636023100" {
		t.Fatalf("blank imo should fall back to mmsi, got %q", got)
	}
}

func TestPickBestUsesPrecedenceThenRecency(t *testing.T) {
	older := time.Now().Add(-2 * time.Hour)
	newer := time.Now().Add(-1 * time.Hour)
	best := PickBest([]MergedVesselPosition{
		{MMSI: 123, DataSource: "maritime_redis", ObservedAt: newer},
		{MMSI: 123, DataSource: "live_ais", ObservedAt: older},
	})
	if best == nil || best.DataSource != "live_ais" {
		t.Fatalf("expected live_ais, got %#v", best)
	}
	sameRank := PickBest([]MergedVesselPosition{
		{MMSI: 1, DataSource: "aisstream", ObservedAt: older},
		{MMSI: 1, DataSource: "aisstream_snapshot", ObservedAt: newer},
	})
	if sameRank == nil || !sameRank.ObservedAt.Equal(newer) {
		t.Fatalf("expected newer aisstream tier row, got %#v", sameRank)
	}
}
