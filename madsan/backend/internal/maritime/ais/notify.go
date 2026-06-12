package ais

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const vesselDeltaChannel = "vessel_delta"

type vesselDeltaPayload struct {
	MMSI        string    `json:"mmsi"`
	Name        string    `json:"name,omitempty"`
	VesselType  string    `json:"vessel_type,omitempty"`
	Lat         float64   `json:"lat"`
	Lon         float64   `json:"lon"`
	Course      *float64  `json:"course,omitempty"`
	Heading     *float64  `json:"heading,omitempty"`
	SpeedKnots  *float64  `json:"speed_knots,omitempty"`
	Destination string    `json:"destination,omitempty"`
	LastSeenAt  time.Time `json:"last_seen_at"`
	Source      string    `json:"source"`
}

func notifyVesselDelta(ctx context.Context, pool *pgxpool.Pool, u *Update, tankerClass string) error {
	vesselType := "Tanker"
	if tankerClass != "" && tankerClass != "unknown" {
		vesselType = tankerClass
	}
	payload := vesselDeltaPayload{
		MMSI:        strconv.FormatInt(u.MMSI, 10),
		Name:        u.Name,
		VesselType:  vesselType,
		Lat:         u.Lat,
		Lon:         u.Lon,
		Destination: u.Destination,
		LastSeenAt:  u.Timestamp,
		Source:      "aisstream",
	}
	if u.HasKinematics {
		payload.SpeedKnots = &u.Speed
		if c, ok := ValidCourse(u.Course, u.Speed); ok {
			payload.Course = &c
		}
		if h, ok := ValidHeading(u.Heading, u.Speed); ok {
			payload.Heading = &h
		}
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `SELECT pg_notify($1, $2)`, vesselDeltaChannel, string(b))
	return err
}
