package licensemap

import "testing"

func TestCollapseClustersTightViewportMergesCountryView(t *testing.T) {
	clusters := []ClusterMarker{
		{Lat: 4, Lng: -2, MapClusterCount: 303, MapClusterGridDeg: 8, Sector: "mining"},
		{Lat: 6, Lng: -1, MapClusterCount: 185, MapClusterGridDeg: 8, Sector: "mining"},
	}
	out := CollapseClustersTightViewport(clusters, 4.5, 8.5, -3.5, 1.5, floatPtr(6))
	if len(out) != 1 {
		t.Fatalf("expected 1 cluster, got %d", len(out))
	}
	if out[0].MapClusterCount != 488 {
		t.Fatalf("expected 488, got %d", out[0].MapClusterCount)
	}
}

func TestCollapseClustersTightViewportSkipsWideViewport(t *testing.T) {
	clusters := []ClusterMarker{
		{Lat: 4, Lng: -2, MapClusterCount: 303, MapClusterGridDeg: 8, Sector: "mining"},
		{Lat: 6, Lng: -1, MapClusterCount: 185, MapClusterGridDeg: 8, Sector: "mining"},
	}
	out := CollapseClustersTightViewport(clusters, -10, 20, -20, 20, floatPtr(6))
	if len(out) != 2 {
		t.Fatalf("expected 2 clusters, got %d", len(out))
	}
}
