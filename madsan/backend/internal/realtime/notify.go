package realtime

import (
	"time"
)

const (
	// VesselDeltaChannel is the Postgres NOTIFY channel for live AIS map updates.
	VesselDeltaChannel = "vessel_delta"
	// LivePositionMaxAge is the window for map live overlay and dossier position trust.
	LivePositionMaxAge = 12 * time.Hour
)

// PositionIsLive reports whether a last_seen_at is fresh enough for live map placement.
func PositionIsLive(lastSeen time.Time) bool {
	if lastSeen.IsZero() {
		return false
	}
	return time.Since(lastSeen) <= LivePositionMaxAge
}
