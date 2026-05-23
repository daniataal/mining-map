package licensemap

import "testing"

func TestMergeClustersCombinesNeighbors(t *testing.T) {
	clusters := []ClusterMarker{
		{ID: "cluster:0:0", Lat: 0, Lng: 0, MapClusterCount: 10, Sector: "mining"},
		{ID: "cluster:6:0", Lat: 6, Lng: 0, MapClusterCount: 20, Sector: "mining"},
	}
	merged := MergeClusters(clusters, 6.0)
	if len(merged) != 1 {
		t.Fatalf("expected 1 merged cluster, got %d", len(merged))
	}
	if merged[0].MapClusterCount != 30 {
		t.Fatalf("expected count 30, got %d", merged[0].MapClusterCount)
	}
}
