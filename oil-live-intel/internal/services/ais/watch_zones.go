package ais

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LoadWatchZoneBoxes returns AISStream bounding boxes for maritime_watch_zones (priority order).
func LoadWatchZoneBoxes(ctx context.Context, pool *pgxpool.Pool) ([]BoundingBox, error) {
	rows, err := pool.Query(ctx, `
		SELECT min_lat::float8, min_lng::float8, max_lat::float8, max_lng::float8
		FROM maritime_watch_zones
		ORDER BY priority ASC, id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]BoundingBox, 0)
	for rows.Next() {
		var minLat, minLng, maxLat, maxLng float64
		if err := rows.Scan(&minLat, &minLng, &maxLat, &maxLng); err != nil {
			return out, err
		}
		out = append(out, BoundingBox{{minLat, minLng}, {maxLat, maxLng}})
	}
	return out, rows.Err()
}

// MergeBoundingBoxes appends watch-zone boxes then terminal-derived boxes (dedupe exact duplicates).
func MergeBoundingBoxes(primary, extra []BoundingBox) []BoundingBox {
	seen := map[string]bool{}
	out := make([]BoundingBox, 0, len(primary)+len(extra))
	add := func(b BoundingBox) {
		key := boxKey(b)
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, b)
	}
	for _, b := range primary {
		add(b)
	}
	for _, b := range extra {
		add(b)
	}
	return out
}

func boxKey(b BoundingBox) string {
	return fmt.Sprintf("%.4f,%.4f,%.4f,%.4f", b[0][0], b[0][1], b[1][0], b[1][1])
}
