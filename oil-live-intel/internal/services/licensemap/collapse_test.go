package licensemap

import "testing"

func TestCollapseClustersTightViewportMergesCountryView(t *testing.T) {
	clusters := []ClusterMarker{
		{Lat: 4, Lng: -2, MapClusterCount: 120, MapClusterGridDeg: 8, Sector: "mining"},
		{Lat: 6, Lng: -1, MapClusterCount: 80, MapClusterGridDeg: 8, Sector: "mining"},
	}
	out := CollapseClustersTightViewport(clusters, 4.5, 8.5, -3.5, 1.5, floatPtr(6))
	if len(out) != 1 {
		t.Fatalf("expected 1 cluster, got %d", len(out))
	}
	if out[0].MapClusterCount != 200 {
		t.Fatalf("expected 200, got %d", out[0].MapClusterCount)
	}
	// Edge-aligned dominant cell snaps to viewport interior center.
	if out[0].Lat != 6.5 || out[0].Lng != -1.0 {
		t.Fatalf("expected snapped viewport center (6.5, -1), got (%.1f, %.1f)", out[0].Lat, out[0].Lng)
	}
}

func TestCollapseClustersTightViewportSkipsHugeTotal(t *testing.T) {
	clusters := []ClusterMarker{
		{Lat: 6, Lng: -1, MapClusterCount: 250, MapClusterGridDeg: 8, Country: "Ghana"},
		{Lat: 7, Lng: -0.5, MapClusterCount: 250, MapClusterGridDeg: 8, Country: "Ghana"},
	}
	out := CollapseClustersTightViewport(clusters, 5, 9, -2, 0, floatPtr(6))
	if len(out) != 2 {
		t.Fatalf("expected 2 clusters when total > cap, got %d", len(out))
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
