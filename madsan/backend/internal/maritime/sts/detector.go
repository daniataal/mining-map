package sts

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/maritime/geofence"
)

const (
	DefaultMaxDistanceM     = 500
	DefaultMaxSOG           = 1.5
	DefaultMinDuration      = 2 * time.Hour
	DefaultBucketMinutes    = 15
	maxSTSDetectWindowHours = 24
)

// Candidate is a detected co-proximity session between two MMSIs.
type Candidate struct {
	MMSIA         string
	MMSIB         string
	StartTS       time.Time
	EndTS         time.Time
	MinDistanceM  float64
	AvgSOG        float64
	CentroidLat   float64
	CentroidLon   float64
	SampleBuckets int
}

// VesselMeta is tanker classification used for scoring.
type VesselMeta struct {
	ID          uuid.UUID
	Name        string
	TankerClass string
}

// DetectConfig tunes proximity detection over a rolling AIS window.
type DetectConfig struct {
	WindowStart    time.Time
	WindowEnd      time.Time
	MaxDistanceM   float64
	MaxSOG         float64
	MinDuration    time.Duration
	BucketMinutes  int
	PositionsTable string
	SpeedColumn    string
}

// DefaultDetectConfig returns settings for madsan ais_positions rolling buffer.
func DefaultDetectConfig(retainHours int) DetectConfig {
	end := time.Now().UTC()
	scanHours := capDetectWindowHours(retainHours)
	return DetectConfig{
		WindowEnd:      end,
		WindowStart:    end.Add(-time.Duration(scanHours) * time.Hour),
		MaxDistanceM:   DefaultMaxDistanceM,
		MaxSOG:         DefaultMaxSOG,
		MinDuration:    DefaultMinDuration,
		BucketMinutes:  DefaultBucketMinutes,
		PositionsTable: "ais_positions",
		SpeedColumn:    "speed_knots",
	}
}

func capDetectWindowHours(retainHours int) int {
	if retainHours <= 0 {
		retainHours = 72
	}
	if retainHours > maxSTSDetectWindowHours {
		return maxSTSDetectWindowHours
	}
	return retainHours
}

// Detect finds slow co-proximity sessions from stored AIS positions.
func Detect(ctx context.Context, pool *pgxpool.Pool, cfg DetectConfig) ([]Candidate, error) {
	if cfg.PositionsTable == "" {
		cfg.PositionsTable = "ais_positions"
	}
	if cfg.SpeedColumn == "" {
		cfg.SpeedColumn = "speed_knots"
	}
	if cfg.MaxDistanceM <= 0 {
		cfg.MaxDistanceM = DefaultMaxDistanceM
	}
	if cfg.MaxSOG <= 0 {
		cfg.MaxSOG = DefaultMaxSOG
	}
	if cfg.MinDuration <= 0 {
		cfg.MinDuration = DefaultMinDuration
	}
	if cfg.BucketMinutes <= 0 {
		cfg.BucketMinutes = DefaultBucketMinutes
	}

	speedCol := cfg.SpeedColumn
	scanHours := int(cfg.WindowEnd.Sub(cfg.WindowStart).Hours())
	if scanHours <= 0 {
		scanHours = capDetectWindowHours(72)
	}
	q := fmt.Sprintf(`
		WITH bucketed AS (
			SELECT
				mmsi,
				date_trunc('hour', ts) +
					(floor(extract(minute FROM ts) / %d) * %d) * interval '1 minute' AS bucket,
				MIN(ts) AS ts,
				ST_Centroid(ST_Collect(geom::geometry)) AS geom,
				AVG(COALESCE(%s, 0)) AS speed
			FROM %s
			WHERE ts >= now() - ($1::int * INTERVAL '1 hour')
				AND COALESCE(%s, 99) <= $2::double precision
			GROUP BY mmsi, 2
		),
		proximity AS (
			SELECT
				LEAST(a.mmsi, b.mmsi) AS mmsi_a,
				GREATEST(a.mmsi, b.mmsi) AS mmsi_b,
				a.bucket,
				MIN(ST_Distance(a.geom::geography, b.geom::geography)) AS min_dist_m,
				AVG((a.speed + b.speed) / 2.0) AS avg_sog,
				AVG((ST_Y(a.geom) + ST_Y(b.geom)) / 2.0) AS lat,
				AVG((ST_X(a.geom) + ST_X(b.geom)) / 2.0) AS lon,
				MIN(a.ts) AS bucket_start,
				MAX(a.ts) AS bucket_end
			FROM bucketed a
			INNER JOIN bucketed b ON a.mmsi < b.mmsi
				AND a.bucket = b.bucket
				AND ST_DWithin(a.geom::geography, b.geom::geography, $3::double precision)
			GROUP BY 1, 2, 3
		)
		SELECT
			mmsi_a, mmsi_b,
			MIN(bucket_start) AS start_ts,
			MAX(bucket_end) AS end_ts,
			MIN(min_dist_m) AS min_distance_m,
			AVG(avg_sog) AS avg_sog,
			AVG(lat) AS centroid_lat,
			AVG(lon) AS centroid_lon,
			COUNT(*)::int AS sample_buckets
		FROM proximity
		GROUP BY mmsi_a, mmsi_b
		HAVING MAX(bucket_end) - MIN(bucket_start) >= ($4::double precision * INTERVAL '1 second')
	`, cfg.BucketMinutes, cfg.BucketMinutes, speedCol, cfg.PositionsTable, speedCol)

	minDurSecs := cfg.MinDuration.Seconds()
	rows, err := pool.Query(ctx, q,
		scanHours, cfg.MaxSOG, cfg.MaxDistanceM, minDurSecs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Candidate
	for rows.Next() {
		var c Candidate
		if err := rows.Scan(
			&c.MMSIA, &c.MMSIB, &c.StartTS, &c.EndTS,
			&c.MinDistanceM, &c.AvgSOG, &c.CentroidLat, &c.CentroidLon, &c.SampleBuckets,
		); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// RunCycle detects candidates, scores with the 6-factor model, and persists core_signals.
func RunCycle(ctx context.Context, pool *pgxpool.Pool, termIndex *geofence.Index, retainHours int) (int, error) {
	cfg := DefaultDetectConfig(retainHours)
	candidates, err := Detect(ctx, pool, cfg)
	if err != nil {
		return 0, err
	}
	candidates = dedupeCandidates(candidates)
	written := 0
	for _, c := range candidates {
		if termIndex != nil && termIndex.Match(c.CentroidLat, c.CentroidLon) != nil {
			continue
		}
		metaA, err := loadVesselMeta(ctx, pool, c.MMSIA)
		if err != nil {
			return written, err
		}
		metaB, err := loadVesselMeta(ctx, pool, c.MMSIB)
		if err != nil {
			return written, err
		}
		zoneID, zoneName, inZone, err := matchSTSZone(ctx, pool, c.CentroidLat, c.CentroidLon)
		if err != nil {
			return written, err
		}
		bothTankers := isTanker(metaA.TankerClass) && isTanker(metaB.TankerClass)
		if err := persistSTSSignal(ctx, pool, c, metaA, metaB, zoneID, zoneName, inZone, bothTankers); err != nil {
			return written, err
		}
		written++
	}
	return written, nil
}

func loadVesselMeta(ctx context.Context, pool *pgxpool.Pool, mmsi string) (VesselMeta, error) {
	var meta VesselMeta
	err := pool.QueryRow(ctx, `
		SELECT id, COALESCE(name,''), COALESCE(vessel_type,'')
		FROM vessels WHERE mmsi = $1::text
	`, mmsi).Scan(&meta.ID, &meta.Name, &meta.TankerClass)
	if err == pgx.ErrNoRows {
		return VesselMeta{}, nil
	}
	if err != nil {
		return VesselMeta{}, err
	}
	return meta, nil
}

func isTanker(class string) bool {
	switch class {
	case "crude", "product", "chemical", "lng", "lpg", "tanker", "Tanker", "Crude Oil Tanker", "Oil/Chemical Tanker":
		return true
	default:
		return false
	}
}

func matchSTSZone(ctx context.Context, pool *pgxpool.Pool, lat, lon float64) (*uuid.UUID, string, bool, error) {
	var id uuid.UUID
	var name string
	err := pool.QueryRow(ctx, `
		SELECT id, name FROM sts_zones
		WHERE geom IS NOT NULL
		  AND ST_Contains(geom::geometry, ST_SetSRID(ST_MakePoint($1::double precision, $2::double precision), 4326))
		ORDER BY confidence DESC
		LIMIT 1
	`, lon, lat).Scan(&id, &name)
	if err == pgx.ErrNoRows {
		return nil, "", false, nil
	}
	if err != nil {
		return nil, "", false, err
	}
	return &id, name, true, nil
}

func dedupeCandidates(in []Candidate) []Candidate {
	if len(in) <= 1 {
		return in
	}
	out := make([]Candidate, 0, len(in))
	for _, c := range in {
		merged := false
		for i := range out {
			if !samePair(c, out[i]) {
				continue
			}
			if candidatesOverlap(c, out[i]) {
				out[i] = mergeCandidate(out[i], c)
				merged = true
				break
			}
		}
		if !merged {
			out = append(out, c)
		}
	}
	return out
}

func samePair(a, b Candidate) bool {
	return a.MMSIA == b.MMSIA && a.MMSIB == b.MMSIB
}

func candidatesOverlap(a, b Candidate) bool {
	overlapStart := maxTime(a.StartTS, b.StartTS)
	overlapEnd := minTime(a.EndTS, b.EndTS)
	if !overlapEnd.After(overlapStart) {
		return false
	}
	overlap := overlapEnd.Sub(overlapStart)
	shorter := minDuration(a.EndTS.Sub(a.StartTS), b.EndTS.Sub(b.StartTS))
	if shorter <= 0 {
		return a.StartTS.Sub(b.StartTS).Abs() <= 2*time.Hour
	}
	return overlap >= shorter/2 || a.StartTS.Sub(b.StartTS).Abs() <= 2*time.Hour
}

func mergeCandidate(a, b Candidate) Candidate {
	if b.StartTS.Before(a.StartTS) {
		a.StartTS = b.StartTS
	}
	if b.EndTS.After(a.EndTS) {
		a.EndTS = b.EndTS
	}
	if b.MinDistanceM < a.MinDistanceM {
		a.MinDistanceM = b.MinDistanceM
	}
	if b.SampleBuckets > a.SampleBuckets {
		a.SampleBuckets = b.SampleBuckets
	}
	a.AvgSOG = (a.AvgSOG + b.AvgSOG) / 2
	a.CentroidLat = (a.CentroidLat + b.CentroidLat) / 2
	a.CentroidLon = (a.CentroidLon + b.CentroidLon) / 2
	return a
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
