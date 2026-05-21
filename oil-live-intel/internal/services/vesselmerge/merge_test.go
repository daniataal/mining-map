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
