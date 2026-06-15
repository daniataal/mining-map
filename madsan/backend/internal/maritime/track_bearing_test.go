package maritime

import "testing"

func TestBearingFromDeltaCarmeliaApproach(t *testing.T) {
	// Last two Haifa approach fixes for CARMELIA (MMSI 209048000).
	b := BearingFromDelta(32.87984, 35.012, 32.88087, 35.01834)
	if b < 60 || b > 110 {
		t.Fatalf("expected E/ENE bearing ~80°, got %.1f°", b)
	}
	if HaversineM(32.87984, 35.012, 32.88087, 35.01834) < MinTrackSegmentM {
		t.Fatal("segment should exceed minimum inference distance")
	}
}
