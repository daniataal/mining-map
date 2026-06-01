package licensemap

import "testing"

func TestViewportGridCellCenterGhanaView(t *testing.T) {
	// Ghana-ish viewport: licenses at (6, -1) should land on land, not Gulf lng=-4.
	minLat, minLng, g := 4.0, -4.0, 8.0
	latBucket := int((6.0 - minLat) / g) // 0
	lngBucket := int((-1.0 - minLng) / g)
	lat, lng := ViewportGridCellCenter(minLat, minLng, g, latBucket, lngBucket)
	if lat != 8.0 || lng != 0.0 {
		t.Fatalf("expected (8, 0), got (%.2f, %.2f)", lat, lng)
	}
	if lat < minLat || lat > 12 || lng < -3.5 || lng > 1.5 {
		t.Fatalf("center outside Ghana interior: (%.2f, %.2f)", lat, lng)
	}
}

func TestDominantClusterCenterNotWeighted(t *testing.T) {
	clusters := []ClusterMarker{
		{Lat: 3, Lng: 3, MapClusterCount: 10},
		{Lat: 9, Lng: 3, MapClusterCount: 20},
	}
	lat, lng, ok := dominantClusterCenter(clusters)
	if !ok || lat != 9 || lng != 3 {
		t.Fatalf("expected dominant (9, 3), got (%.1f, %.1f) ok=%v", lat, lng, ok)
	}
}

func TestSnapClusterToViewportKeepsInterior(t *testing.T) {
	lat, lng := snapClusterToViewport(7.0, -1.0, 4.0, 12.0, -4.0, 2.0, 8.0)
	if lat != 7.0 || lng != -1.0 {
		t.Fatalf("interior center should be unchanged, got (%.2f, %.2f)", lat, lng)
	}
}

func TestSnapClusterToViewportOffshoreSnaps(t *testing.T) {
	lat, lng := snapClusterToViewport(4.0, -4.0, 4.0, 12.0, -4.0, 2.0, 8.0)
	if lat != 8.0 || lng != -1.0 {
		t.Fatalf("offshore global grid center should snap to viewport center, got (%.2f, %.2f)", lat, lng)
	}
}
