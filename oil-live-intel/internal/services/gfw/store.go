package gfw

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// UpsertTrackPoints idempotently writes GFW archive rows into oil_ais_track_points.
func UpsertTrackPoints(ctx context.Context, pool *pgxpool.Pool, points []TrackPoint) (int, error) {
	if len(points) == 0 {
		return 0, nil
	}
	const q = `
		INSERT INTO oil_ais_track_points (mmsi, ts, lat, lon, sog, cog, geom, data_source, source_record_id)
		VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326), $9, $10)
		ON CONFLICT (data_source, source_record_id) WHERE source_record_id IS NOT NULL DO NOTHING
	`
	var written int
	for _, p := range points {
		if p.MMSI <= 0 || p.SourceRecordID == "" {
			continue
		}
		ds := p.DataSource
		if ds == "" {
			ds = "gfw"
		}
		tag, err := pool.Exec(ctx, q,
			p.MMSI, p.Timestamp, p.Lat, p.Lon, p.SOG, p.COG, p.Lon, p.Lat, ds, p.SourceRecordID,
		)
		if err != nil {
			return written, fmt.Errorf("upsert track point %s: %w", p.SourceRecordID, err)
		}
		written += int(tag.RowsAffected())
	}
	return written, nil
}
