package licensemap

import "testing"

func TestCountrySummaryLandSnap(t *testing.T) {
	// Offshore median for Ghana should snap to land envelope center.
	lat, lng := RefineClusterLandPosition(2.0, -2.0, "Ghana")
	bbox, ok := CountryLandBBox("Ghana")
	if !ok {
		t.Fatal("expected Ghana bbox")
	}
	clat, clng := bbox.center()
	if lat != clat || lng != clng {
		t.Fatalf("snap got %f,%f want center %f,%f", lat, lng, clat, clng)
	}
}
