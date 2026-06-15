package ais

// ValidHeading returns true heading (bow direction) when AIS reports a usable value.
// 511 is the ITU-R M.1371 "heading not available" sentinel.
// At low SOG many transponders emit heading=0 as a placeholder — prefer COG when moving.
func ValidHeading(h float64, speedKnots float64) (float64, bool) {
	if h < 0 || h >= 360 || h == 511 {
		return 0, false
	}
	if h == 0 && speedKnots < 0.1 {
		return 0, false
	}
	return h, true
}

// ValidCourse returns course-over-ground when the vessel is moving.
// Stationary targets often report Cog=0 meaning not available, not north.
func ValidCourse(cog float64, speedKnots float64) (float64, bool) {
	if cog < 0 || cog >= 360 {
		return 0, false
	}
	if speedKnots < 0.1 {
		return 0, false
	}
	return cog, true
}

// HasPositionKinematics is true for AIS message types that carry SOG/COG/heading.
func HasPositionKinematics(messageType string) bool {
	switch messageType {
	case "PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport":
		return true
	default:
		return false
	}
}
