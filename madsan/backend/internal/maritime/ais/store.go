package ais

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/intelligence"
)

// PersistPosition inserts into ais_positions when throttle elapsed.
func PersistPosition(ctx context.Context, pool *pgxpool.Pool, u *Update, minInterval time.Duration) (bool, error) {
	if !u.HasKinematics {
		return false, nil
	}
	mmsi := strconv.FormatInt(u.MMSI, 10)
	var lastTS time.Time
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(ts), '1970-01-01'::timestamptz) FROM ais_positions WHERE mmsi = $1
	`, mmsi).Scan(&lastTS)
	if err != nil {
		return false, err
	}
	if time.Since(lastTS) < minInterval {
		return false, nil
	}
	raw, _ := json.Marshal(u.Raw)
	var speed, course, heading any
	if u.HasKinematics {
		speed = u.Speed
		if c, ok := ValidCourse(u.Course, u.Speed); ok {
			course = c
		}
		if h, ok := ValidHeading(u.Heading, u.Speed); ok {
			heading = h
		}
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO ais_positions (
			mmsi, ts, lat, lon, speed_knots, course, heading, nav_status,
			draft_m, destination, eta, geom, raw
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
			ST_SetSRID(ST_MakePoint($12, $13), 4326)::geography, $14
		)
	`, mmsi, u.Timestamp, u.Lat, u.Lon, speed, course, heading, u.NavStatus,
		nullableDraft(u.HasDraft, u.DraftM), nullStr(u.Destination), nullStr(u.ETA),
		u.Lon, u.Lat, raw)
	return err == nil, err
}

// UpsertVessel updates madsan_db.vessels from a live AIS frame.
func UpsertVessel(ctx context.Context, pool *pgxpool.Pool, u *Update, tankerClass string) (uuid.UUID, bool, error) {
	mmsi := strconv.FormatInt(u.MMSI, 10)
	vesselType := "Tanker"
	if tankerClass != "" && tankerClass != "unknown" {
		vesselType = tankerClass
	}
	var speed, course, heading *float64
	if u.HasKinematics {
		s := u.Speed
		speed = &s
		if c, ok := ValidCourse(u.Course, u.Speed); ok {
			course = &c
		}
		if h, ok := ValidHeading(u.Heading, u.Speed); ok {
			heading = &h
		}
	}

	var id uuid.UUID
	var fresh bool
	err := pool.QueryRow(ctx, `
		INSERT INTO vessels (
			name, imo, mmsi, vessel_type, latitude, longitude, geom,
			course, heading, speed_knots, destination, last_seen_at,
			confidence_score, data_quality_status
		) VALUES (
			$1, NULLIF($2,''), $3, $4,
			CASE WHEN $12::bool THEN $5::double precision END,
			CASE WHEN $12::bool THEN $6::double precision END,
			CASE WHEN $12::bool AND $5::double precision IS NOT NULL AND $6::double precision IS NOT NULL
				THEN ST_SetSRID(ST_MakePoint($6::double precision, $5::double precision), 4326)::geography END,
			$7, $8, $9, NULLIF($10,''), CASE WHEN $12::bool THEN $11::timestamptz END, 70, 'observed'
		)
		ON CONFLICT (mmsi) DO UPDATE SET
			name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE vessels.name END,
			imo = COALESCE(NULLIF(EXCLUDED.imo,''), vessels.imo),
			vessel_type = COALESCE(NULLIF(EXCLUDED.vessel_type,''), vessels.vessel_type),
			latitude = CASE
				WHEN $12::bool IS FALSE THEN vessels.latitude
				WHEN EXCLUDED.last_seen_at >= COALESCE(vessels.last_seen_at, 'epoch'::timestamptz)
				THEN EXCLUDED.latitude ELSE vessels.latitude END,
			longitude = CASE
				WHEN $12::bool IS FALSE THEN vessels.longitude
				WHEN EXCLUDED.last_seen_at >= COALESCE(vessels.last_seen_at, 'epoch'::timestamptz)
				THEN EXCLUDED.longitude ELSE vessels.longitude END,
			geom = CASE
				WHEN $12::bool IS FALSE THEN vessels.geom
				WHEN EXCLUDED.last_seen_at >= COALESCE(vessels.last_seen_at, 'epoch'::timestamptz)
				THEN EXCLUDED.geom ELSE vessels.geom END,
			course = CASE
				WHEN $12::bool IS FALSE THEN vessels.course
				WHEN EXCLUDED.last_seen_at >= COALESCE(vessels.last_seen_at, 'epoch'::timestamptz)
				THEN EXCLUDED.course
				WHEN vessels.course IS NULL THEN EXCLUDED.course
				ELSE vessels.course END,
			heading = CASE
				WHEN $12::bool IS FALSE THEN vessels.heading
				WHEN EXCLUDED.last_seen_at >= COALESCE(vessels.last_seen_at, 'epoch'::timestamptz)
				THEN EXCLUDED.heading
				WHEN vessels.heading IS NULL THEN EXCLUDED.heading
				ELSE vessels.heading END,
			speed_knots = CASE
				WHEN $12::bool IS FALSE THEN vessels.speed_knots
				WHEN EXCLUDED.last_seen_at >= COALESCE(vessels.last_seen_at, 'epoch'::timestamptz)
				THEN EXCLUDED.speed_knots ELSE vessels.speed_knots END,
			destination = COALESCE(NULLIF(EXCLUDED.destination,''), vessels.destination),
			last_seen_at = CASE
				WHEN $12::bool THEN GREATEST(COALESCE(vessels.last_seen_at, EXCLUDED.last_seen_at), EXCLUDED.last_seen_at)
				ELSE vessels.last_seen_at END,
			updated_at = now()
		RETURNING id, ($12::bool AND last_seen_at = $11::timestamptz) AS position_fresh
	`, u.Name, u.IMO, mmsi, vesselType, u.Lat, u.Lon, course, heading, speed, u.Destination, u.Timestamp, u.HasKinematics).Scan(&id, &fresh)
	if err != nil {
		return uuid.Nil, false, err
	}
	if fresh {
		_ = intelligence.PersistVesselAIS(ctx, pool, id, u.Timestamp, speed, 70)
	}
	return id, fresh, nil
}

func UpdateSourceHealth(ctx context.Context, pool *pgxpool.Pool, observationCount int, lastError error) error {
	status := "ok"
	var limitations []string
	if lastError != nil {
		status = "error"
		limitations = []string{lastError.Error()}
	} else if observationCount == 0 {
		status = "connecting"
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO maritime_source_health (
			source, source_type, display_name, status, coverage_tier,
			last_observation_at, observation_count, limitations, updated_at
		) VALUES (
			'aisstream', 'community_coastal_ais', 'AISStream', $1, 'open_partial',
			CASE WHEN $2 > 0 THEN now() ELSE NULL END, $2, COALESCE($3, ARRAY[]::TEXT[]), now()
		)
		ON CONFLICT (source) DO UPDATE SET
			status = EXCLUDED.status,
			last_observation_at = COALESCE(EXCLUDED.last_observation_at, maritime_source_health.last_observation_at),
			observation_count = maritime_source_health.observation_count + EXCLUDED.observation_count,
			limitations = CASE
				WHEN EXCLUDED.status = 'error' THEN EXCLUDED.limitations
				ELSE maritime_source_health.limitations
			END,
			updated_at = EXCLUDED.updated_at
	`, status, observationCount, limitations)
	return err
}

// PurgeOldPositions deletes ais_positions older than retainDays.
func PurgeOldPositions(ctx context.Context, pool *pgxpool.Pool, retainDays int) (int64, error) {
	if retainDays <= 0 {
		retainDays = 30
	}
	tag, err := pool.Exec(ctx, `
		DELETE FROM ais_positions WHERE ts < now() - ($1 || ' days')::interval
	`, retainDays)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func LoadAssetCoords(ctx context.Context, pool *pgxpool.Pool) (lats, lons []float64, err error) {
	rows, err := pool.Query(ctx, `
		SELECT latitude, longitude FROM assets
		WHERE geom IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
		  AND asset_type IN ('terminal', 'port', 'refinery', 'tank_farm', 'storage', 'berth', 'lng_terminal')
	`)
	if err != nil {
		return nil, nil, fmt.Errorf("asset coords: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var lat, lon float64
		if err := rows.Scan(&lat, &lon); err != nil {
			return nil, nil, err
		}
		lats = append(lats, lat)
		lons = append(lons, lon)
	}
	return lats, lons, rows.Err()
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullableDraft(ok bool, v float64) any {
	if !ok {
		return nil
	}
	return v
}
