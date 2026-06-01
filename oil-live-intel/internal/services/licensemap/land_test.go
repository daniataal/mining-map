package licensemap

import "testing"

func TestRefineClusterLandPositionGhanaOffshore(t *testing.T) {
	// Gulf of Guinea grid center — should snap to Ghana interior.
	lat, lng := RefineClusterLandPosition(4.0, 0.0, "Ghana")
	if lat < 4.5 || lat > 11.5 || lng < -3.5 || lng > 1.5 {
		t.Fatalf("expected Ghana land box, got (%.2f, %.2f)", lat, lng)
	}
	bbox, _ := CountryLandBBox("Ghana")
	cLat, cLng := bbox.center()
	if lat != cLat || lng != cLng {
		t.Fatalf("expected country center (%.2f, %.2f), got (%.2f, %.2f)", cLat, cLng, lat, lng)
	}
}

func TestRefineClusterLandPositionKeepsInterior(t *testing.T) {
	lat, lng := RefineClusterLandPosition(7.0, -1.0, "Ghana")
	if lat != 7.0 || lng != -1.0 {
		t.Fatalf("interior point should be unchanged, got (%.2f, %.2f)", lat, lng)
	}
}

func TestGhanaViewportClusterMedianLand(t *testing.T) {
	lat, lng := RefineClusterLandPosition(5.5, -0.5, "Ghana")
	bbox, ok := CountryLandBBox("Ghana")
	if !ok || !bbox.contains(lat, lng) {
		t.Fatalf("refined Ghana cluster still offshore: (%.2f, %.2f)", lat, lng)
	}
}
