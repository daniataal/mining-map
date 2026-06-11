package maritime

import "github.com/madsan/intelligence/internal/maritime/ais"

// SanitizeVesselDelta drops AIS placeholder kinematics before upsert/broadcast.
func SanitizeVesselDelta(d *VesselDelta) {
	speed := 0.0
	if d.SpeedKnots != nil {
		speed = *d.SpeedKnots
	}
	if d.Course != nil {
		if c, ok := ais.ValidCourse(*d.Course, speed); ok {
			d.Course = &c
		} else {
			d.Course = nil
		}
	}
	if d.Heading != nil {
		if h, ok := ais.ValidHeading(*d.Heading, speed); ok {
			d.Heading = &h
		} else {
			d.Heading = nil
		}
	}
	if d.SpeedKnots != nil && speed < 0.1 {
		d.SpeedKnots = nil
	}
}
