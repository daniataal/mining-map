package portcall

import "time"

// Position is a normalized AIS frame for port-call detection.
type Position struct {
	MMSI        int64
	Name        string
	Lat         float64
	Lon         float64
	Destination string
	DraftM      float64
	HasDraft    bool
	Timestamp   time.Time
}
