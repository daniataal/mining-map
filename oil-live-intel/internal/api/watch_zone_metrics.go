package api

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// WatchZoneObservation24h is AIS observation count in a maritime watch zone (last 24h).
type WatchZoneObservation24h struct {
	ZoneID            string `json:"zone_id"`
	Name              string `json:"name"`
	ObservationCount  int    `json:"observation_count"`
	HasGap            bool   `json:"has_gap"`
	ExpectedGapReason string `json:"expected_gap_reason,omitempty"`
}

func queryWatchZoneObservations24h(ctx context.Context, pool *pgxpool.Pool) []WatchZoneObservation24h {
	out := []WatchZoneObservation24h{}
	rows, err := pool.Query(ctx, `
		SELECT
			z.id,
			z.name,
			z.expected_gap_reason,
			COALESCE(obs.cnt, 0)::int AS observation_count,
			NOT EXISTS (
				SELECT 1 FROM oil_vessel_position_observations o
				WHERE o.lat >= z.min_lat AND o.lat <= z.max_lat
				  AND o.lng >= z.min_lng AND o.lng <= z.max_lng
				  AND COALESCE(o.position_time, o.observed_at) > now() - interval '3 hours'
			) AS has_gap
		FROM maritime_watch_zones z
		LEFT JOIN LATERAL (
			SELECT COUNT(DISTINCT o.mmsi)::int AS cnt
			FROM oil_vessel_position_observations o
			WHERE o.lat >= z.min_lat AND o.lat <= z.max_lat
			  AND o.lng >= z.min_lng AND o.lng <= z.max_lng
			  AND COALESCE(o.position_time, o.observed_at) > now() - interval '24 hours'
		) obs ON true
		ORDER BY z.priority ASC, z.id ASC
	`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var row WatchZoneObservation24h
		var reason *string
		if err := rows.Scan(&row.ZoneID, &row.Name, &reason, &row.ObservationCount, &row.HasGap); err != nil {
			return out
		}
		if reason != nil {
			row.ExpectedGapReason = *reason
		}
		out = append(out, row)
	}
	return out
}
