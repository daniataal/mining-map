package sts

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mining-map/oil-live-intel/internal/services/geofence"
)

const (
	DefaultMaxDistanceM  = 500
	DefaultMaxSOG        = 1.5
	DefaultMinDuration   = 2 * time.Hour
	DefaultTimeMatchSec  = 900
	DefaultBucketMinutes = 15
)

// Candidate is a detected co-proximity session between two MMSIs.
type Candidate struct {
	MMSIA         int64
	MMSIB         int64
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
	TimeMatchSec   int
	BucketMinutes  int
	PositionsTable string
	SpeedColumn    string
}

// DefaultDetectConfig returns settings for the live 72h rolling buffer.
func DefaultDetectConfig(retainHours int) DetectConfig {
	if retainHours <= 0 {
		retainHours = 72
	}
	end := time.Now().UTC()
	return DetectConfig{
		WindowEnd:      end,
		WindowStart:    end.Add(-time.Duration(retainHours) * time.Hour),
		MaxDistanceM:   DefaultMaxDistanceM,
		MaxSOG:         DefaultMaxSOG,
		MinDuration:    DefaultMinDuration,
		TimeMatchSec:   DefaultTimeMatchSec,
		BucketMinutes:  DefaultBucketMinutes,
		PositionsTable: "oil_ais_positions",
		SpeedColumn:    "speed",
	}
}

// ArchiveDetectConfig returns settings for GFW archive track points.
func ArchiveDetectConfig(backfillDays int) DetectConfig {
	if backfillDays <= 0 {
		backfillDays = 7
	}
	end := time.Now().UTC()
	return DetectConfig{
		WindowEnd:      end,
		WindowStart:    end.Add(-time.Duration(backfillDays) * 24 * time.Hour),
		MaxDistanceM:   DefaultMaxDistanceM,
		MaxSOG:         DefaultMaxSOG,
		MinDuration:    DefaultMinDuration,
		TimeMatchSec:   DefaultTimeMatchSec,
		BucketMinutes:  DefaultBucketMinutes,
		PositionsTable: "oil_ais_track_points",
		SpeedColumn:    "sog",
	}
}

// Detect finds slow co-proximity sessions from stored AIS positions.
func Detect(ctx context.Context, pool *pgxpool.Pool, cfg DetectConfig) ([]Candidate, error) {
	if cfg.PositionsTable == "" {
		cfg.PositionsTable = "oil_ais_positions"
	}
	if cfg.SpeedColumn == "" {
		cfg.SpeedColumn = "speed"
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
	if cfg.TimeMatchSec <= 0 {
		cfg.TimeMatchSec = DefaultTimeMatchSec
	}
	if cfg.BucketMinutes <= 0 {
		cfg.BucketMinutes = DefaultBucketMinutes
	}

	speedCol := cfg.SpeedColumn
	q := fmt.Sprintf(`
		WITH proximity AS (
			SELECT
				LEAST(a.mmsi, b.mmsi) AS mmsi_a,
				GREATEST(a.mmsi, b.mmsi) AS mmsi_b,
				date_trunc('hour', a.ts) +
					(floor(extract(minute FROM a.ts) / %d) * %d) * interval '1 minute' AS bucket,
				MIN(ST_Distance(a.geom::geography, b.geom::geography)) AS min_dist_m,
				AVG((COALESCE(a.%s, 0) + COALESCE(b.%s, 0)) / 2.0) AS avg_sog,
				AVG((ST_Y(a.geom::geometry) + ST_Y(b.geom::geometry)) / 2.0) AS lat,
				AVG((ST_X(a.geom::geometry) + ST_X(b.geom::geometry)) / 2.0) AS lon,
				MIN(a.ts) AS bucket_start,
				MAX(a.ts) AS bucket_end
			FROM %s a
			INNER JOIN %s b ON a.mmsi < b.mmsi
				AND abs(extract(epoch FROM (a.ts - b.ts))) <= $5
				AND ST_DWithin(a.geom::geography, b.geom::geography, $6)
			WHERE a.ts >= $1 AND a.ts <= $2
				AND COALESCE(a.%s, 99) <= $3
				AND COALESCE(b.%s, 99) <= $3
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
		HAVING MAX(bucket_end) - MIN(bucket_start) >= $4::interval
	`, cfg.BucketMinutes, cfg.BucketMinutes, speedCol, speedCol, cfg.PositionsTable, cfg.PositionsTable, speedCol, speedCol)

	minDur := fmt.Sprintf("%f hours", cfg.MinDuration.Hours())
	rows, err := pool.Query(ctx, q,
		cfg.WindowStart, cfg.WindowEnd, cfg.MaxSOG, minDur, cfg.TimeMatchSec, cfg.MaxDistanceM)
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

// RunCycle detects candidates from live and archive AIS, dedupes, and persists events.
func RunCycle(ctx context.Context, pool *pgxpool.Pool, termIndex *geofence.Index, retainHours, archiveBackfillDays int) (int, error) {
	liveCfg := DefaultDetectConfig(retainHours)
	liveCandidates, err := Detect(ctx, pool, liveCfg)
	if err != nil {
		return 0, err
	}
	archiveCfg := ArchiveDetectConfig(archiveBackfillDays)
	archiveCandidates, err := Detect(ctx, pool, archiveCfg)
	if err != nil {
		return 0, err
	}
	candidates := dedupeCandidates(append(liveCandidates, archiveCandidates...))
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
		durationH := c.EndTS.Sub(c.StartTS).Hours()
		bothTankers := isTanker(metaA.TankerClass) && isTanker(metaB.TankerClass)
		scoreIn := ScoreInput{
			DurationHours:   durationH,
			MinDistanceM:    c.MinDistanceM,
			AvgSOG:          c.AvgSOG,
			BothTankers:     bothTankers,
			SameTankerClass: bothTankers && metaA.TankerClass == metaB.TankerClass && metaA.TankerClass != "",
			InSTSZone:       inZone,
			OutsideTerminal: true,
			SampleBuckets:   c.SampleBuckets,
		}
		tier, score := Score(scoreIn)
		evidence := BuildEvidence(scoreIn, metaA.TankerClass, metaB.TankerClass, zoneName)
		if err := persistEvent(ctx, pool, c, tier, score, evidence, zoneID, []string{liveCfg.PositionsTable, archiveCfg.PositionsTable}); err != nil {
			return written, err
		}
		written++
	}
	return written, nil
}

func loadVesselMeta(ctx context.Context, pool *pgxpool.Pool, mmsi int64) (VesselMeta, error) {
	var meta VesselMeta
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(name,''), COALESCE(tanker_class,'')
		FROM oil_vessels WHERE mmsi = $1
	`, mmsi).Scan(&meta.Name, &meta.TankerClass)
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
	case "crude", "product", "chemical", "lng", "lpg", "tanker":
		return true
	default:
		return false
	}
}

func matchSTSZone(ctx context.Context, pool *pgxpool.Pool, lat, lon float64) (*uuid.UUID, string, bool, error) {
	var id uuid.UUID
	var name string
	err := pool.QueryRow(ctx, `
		SELECT id, name FROM oil_sts_zones
		WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
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

func persistEvent(ctx context.Context, pool *pgxpool.Pool, c Candidate, tier string, score float64, evidence []string, zoneID *uuid.UUID, sourceTables []string) error {
	evJSON, _ := json.Marshal(evidence)
	metaJSON, _ := json.Marshal(map[string]any{
		"detector":         "ais_proximity_v1",
		"positions_tables": sourceTables,
		"disclaimer":       "AIS proximity inference only — not verified cargo transfer",
		"limitations": []string{
			"Persian Gulf / Hormuz coverage may be sparse for the connected AIS provider",
			"GFW archive uses hourly gridded presence (~96h lag), not raw AIS",
			"No draft delta or manifest linkage in MVP",
			"Open-water STS outside seeded zones scores lower",
		},
	})
	_, err := pool.Exec(ctx, `
		INSERT INTO oil_sts_events (
			mmsi_a, mmsi_b, start_ts, end_ts, centroid_lat, centroid_lon,
			min_distance_m, avg_sog, zone_id, confidence_tier, confidence_score,
			evidence, status, data_source, metadata
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'inferred','ais_proximity',$13)
		ON CONFLICT (mmsi_a, mmsi_b, start_ts) DO UPDATE SET
			end_ts = EXCLUDED.end_ts,
			centroid_lat = EXCLUDED.centroid_lat,
			centroid_lon = EXCLUDED.centroid_lon,
			min_distance_m = LEAST(oil_sts_events.min_distance_m, EXCLUDED.min_distance_m),
			avg_sog = EXCLUDED.avg_sog,
			zone_id = COALESCE(EXCLUDED.zone_id, oil_sts_events.zone_id),
			confidence_tier = CASE
				WHEN oil_sts_events.status = 'verified' THEN oil_sts_events.confidence_tier
				ELSE EXCLUDED.confidence_tier
			END,
			confidence_score = CASE
				WHEN oil_sts_events.status = 'verified' THEN oil_sts_events.confidence_score
				ELSE EXCLUDED.confidence_score
			END,
			evidence = CASE
				WHEN oil_sts_events.status = 'verified' THEN oil_sts_events.evidence
				ELSE EXCLUDED.evidence
			END,
			metadata = CASE
				WHEN oil_sts_events.status = 'verified' THEN oil_sts_events.metadata
				ELSE EXCLUDED.metadata
			END,
			updated_at = now()
	`, c.MMSIA, c.MMSIB, c.StartTS, c.EndTS, c.CentroidLat, c.CentroidLon,
		c.MinDistanceM, c.AvgSOG, zoneID, tier, score, evJSON, metaJSON)
	return err
}

// OrderMMSI returns the canonical pair ordering (a < b).
func OrderMMSI(a, b int64) (int64, int64) {
	if a < b {
		return a, b
	}
	return b, a
}
