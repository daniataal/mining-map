// Package vesselmerge reads multi-source vessel position observations and merges
// them for map display without cross-source UPDATE overwrite.
//
// Ingest writers upsert only on (data_source, source_record_id). Unified reads
// pick the latest row per MMSI per data_source, then apply display precedence:
//
//	live_ais > aisstream / aisstream_snapshot > maritime_redis > inferred_port_call
//
// Demo seed port calls (seed_port_calls) are not stored here; hide them in the UI
// when OIL_LIVE_DISABLE_DEMO_SEED=1 (handled outside this package).
package vesselmerge

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const tableName = "oil_vessel_position_observations"

// SourceRank returns display precedence (lower = higher priority).
func SourceRank(dataSource string) int {
	switch dataSource {
	case "live_ais":
		return 0
	case "aisstream", "aisstream_snapshot":
		return 1
	case "maritime_redis":
		return 2
	case "inferred_port_call":
		return 3
	default:
		return 4
	}
}

// MergedVesselPosition is one map-facing position per MMSI after precedence merge.
type MergedVesselPosition struct {
	MMSI       int64
	DataSource string
	Lat        float64
	Lng        float64
	SOG        *float64
	COG        *float64
	VesselName *string
	ObservedAt time.Time
}

// TableReady reports whether the observations table exists.
func TableReady(ctx context.Context, pool *pgxpool.Pool) bool {
	if pool == nil {
		return false
	}
	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
		  SELECT 1 FROM information_schema.tables
		  WHERE table_schema = 'public' AND table_name = $1
		)`, tableName).Scan(&exists)
	return err == nil && exists
}

// HasRows reports whether any observations have been ingested.
func HasRows(ctx context.Context, pool *pgxpool.Pool) bool {
	if pool == nil || !TableReady(ctx, pool) {
		return false
	}
	var n int
	err := pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_vessel_position_observations LIMIT 1`).Scan(&n)
	return err == nil && n > 0
}

// MergedPositionsEnabled is true when OIL_LIVE_MERGED_VESSEL_POSITIONS=1.
func MergedPositionsEnabled() bool {
	v := os.Getenv("OIL_LIVE_MERGED_VESSEL_POSITIONS")
	if v == "" {
		return false
	}
	b, err := strconv.ParseBool(v)
	return err == nil && b
}

// ListMergedVesselsInBbox returns one position per MMSI inside bbox using per-source
// latest observation and display precedence. bbox is [minLon, minLat, maxLon, maxLat].
func ListMergedVesselsInBbox(ctx context.Context, pool *pgxpool.Pool, bbox [4]float64, bboxOK bool, limit int) ([]map[string]any, error) {
	if pool == nil {
		return nil, fmt.Errorf("nil pool")
	}
	if limit <= 0 {
		limit = 200
	}

	q := `
		WITH latest AS (
		  SELECT DISTINCT ON (o.mmsi, o.data_source)
		    o.mmsi, o.data_source, o.lat, o.lng, o.sog, o.cog, o.vessel_name, o.observed_at
		  FROM oil_vessel_position_observations o
		  WHERE o.observed_at > now() - interval '24 hours'`
	args := []any{}
	n := 1
	if bboxOK {
		q += fmt.Sprintf(` AND o.lat >= $%d AND o.lat <= $%d AND o.lng >= $%d AND o.lng <= $%d`, n, n+1, n+2, n+3)
		args = append(args, bbox[1], bbox[3], bbox[0], bbox[2])
		n += 4
	}
	q += `
		  ORDER BY o.mmsi, o.data_source, o.observed_at DESC
		),
		ranked AS (
		  SELECT *,
		    CASE data_source
		      WHEN 'live_ais' THEN 0
		      WHEN 'aisstream' THEN 1
		      WHEN 'aisstream_snapshot' THEN 1
		      WHEN 'maritime_redis' THEN 2
		      WHEN 'inferred_port_call' THEN 3
		      ELSE 4
		    END AS src_rank
		  FROM latest
		)
		SELECT DISTINCT ON (r.mmsi)
		  r.mmsi, r.data_source, r.lat, r.lng, r.sog, r.cog, r.vessel_name, r.observed_at,
		  v.name, v.tanker_class, v.crude_capable, v.product_tanker
		FROM ranked r
		LEFT JOIN oil_vessels v ON v.mmsi = r.mmsi
		ORDER BY r.mmsi, r.src_rank ASC, r.observed_at DESC`
	q += fmt.Sprintf(` LIMIT %d`, limit)

	rows, err := pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []map[string]any
	for rows.Next() {
		var mmsi int64
		var dataSource string
		var lat, lng float64
		var sog, cog *float64
		var vesselName, name, tclass *string
		var observed time.Time
		var crude, product *bool
		if err := rows.Scan(&mmsi, &dataSource, &lat, &lng, &sog, &cog, &vesselName, &observed,
			&name, &tclass, &crude, &product); err != nil {
			return nil, err
		}
		displayName := name
		if displayName == nil && vesselName != nil {
			displayName = vesselName
		}
		item := map[string]any{
			"mmsi": mmsi, "ts": observed, "lat": lat, "lng": lng,
			"data_source": dataSource, "name": displayName,
			"tanker_class": tclass, "crude_capable": crude, "product_tanker": product,
		}
		if sog != nil {
			item["speed"] = *sog
		}
		if cog != nil {
			item["course"] = *cog
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// PickBest picks the highest-precedence observation for one MMSI (for tests).
func PickBest(obs []MergedVesselPosition) *MergedVesselPosition {
	if len(obs) == 0 {
		return nil
	}
	best := &obs[0]
	bestRank := SourceRank(best.DataSource)
	for i := 1; i < len(obs); i++ {
		c := &obs[i]
		r := SourceRank(c.DataSource)
		if r < bestRank || (r == bestRank && c.ObservedAt.After(best.ObservedAt)) {
			best = c
			bestRank = r
		}
	}
	return best
}
