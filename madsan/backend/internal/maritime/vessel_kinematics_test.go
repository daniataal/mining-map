package maritime

import "testing"

func TestSanitizeVesselDeltaDropsPlaceholderZeros(t *testing.T) {
	z := 0.0
	d := VesselDelta{
		MMSI:       "209048000",
		Course:     &z,
		Heading:    &z,
		SpeedKnots: &z,
	}
	SanitizeVesselDelta(&d)
	if d.Course != nil || d.Heading != nil || d.SpeedKnots != nil {
		t.Fatalf("expected nil kinematics, got course=%v heading=%v speed=%v", d.Course, d.Heading, d.SpeedKnots)
	}
}

func TestSanitizeVesselDeltaKeepsSlowBowHeading(t *testing.T) {
	h := 135.0
	s := 0.0
	d := VesselDelta{Heading: &h, SpeedKnots: &s}
	SanitizeVesselDelta(&d)
	if d.Heading == nil || *d.Heading != 135 {
		t.Fatalf("expected bow heading 135, got %v", d.Heading)
	}
}
