package sts

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	contextMatchRadiusM  = 15000.0
	crowdingRadiusM      = 1000.0
	spoofClusterRadiusM  = 150.0
	terminalContextTypes = "'terminal','port','refinery','tank_farm','storage','berth','lng_terminal'"
)

type ContextMatch struct {
	ID        uuid.UUID
	Name      string
	Kind      string
	DistanceM float64
}

type CandidateContext struct {
	MaritimeContext      *ContextMatch
	NearestTerminal      *ContextMatch
	OverlappingPortCalls int
	CrowdingVessels      int
	SpoofClusterVessels  int
	PartnerDegree        int
	DistanceVarianceM    float64
	OnLand               bool
	NearInlandWater      bool
}

func loadCandidateContext(ctx context.Context, pool *pgxpool.Pool, c Candidate) (CandidateContext, error) {
	var out CandidateContext
	eventLat, eventLon := candidateEventPoint(c)
	mc, err := nearestMaritimeContext(ctx, pool, eventLat, eventLon)
	if err != nil {
		return out, err
	}
	out.MaritimeContext = mc
	term, err := nearestOilTerminal(ctx, pool, eventLat, eventLon)
	if err != nil {
		return out, err
	}
	out.NearestTerminal = term
	overlaps, err := overlappingPortCallCount(ctx, pool, c)
	if err != nil {
		return out, err
	}
	out.OverlappingPortCalls = overlaps
	crowding, err := crowdingCount(ctx, pool, c)
	if err != nil {
		return out, err
	}
	out.CrowdingVessels = crowding
	spoof, err := spoofClusterVessels(ctx, pool, c)
	if err != nil {
		return out, err
	}
	out.SpoofClusterVessels = spoof
	degree, err := maxPartnerDegree(ctx, pool, c.MMSIA, c.MMSIB)
	if err != nil {
		return out, err
	}
	out.PartnerDegree = degree
	onLand, nearWater, err := landContext(ctx, pool, eventLat, eventLon)
	if err != nil {
		return out, err
	}
	out.OnLand = onLand
	out.NearInlandWater = nearWater
	variance, err := distanceVariance(ctx, pool, c)
	if err != nil {
		return out, err
	}
	out.DistanceVarianceM = variance
	return out, nil
}

func nearestMaritimeContext(ctx context.Context, pool *pgxpool.Pool, lat, lon float64) (*ContextMatch, error) {
	var m ContextMatch
	err := pool.QueryRow(ctx, `
		SELECT id, COALESCE(NULLIF(port_name,''), NULLIF(name,''), context_type),
		       COALESCE(context_type,''), ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
		FROM maritime_context_zones
		WHERE geom IS NOT NULL
		  AND ST_DWithin(
			geom,
			ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
			GREATEST($3::double precision, COALESCE(radius_m, 0))
		  )
		ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
		LIMIT 1
	`, lon, lat, contextMatchRadiusM).Scan(&m.ID, &m.Name, &m.Kind, &m.DistanceM)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		if isUndefinedTable(err) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

func nearestOilTerminal(ctx context.Context, pool *pgxpool.Pool, lat, lon float64) (*ContextMatch, error) {
	var m ContextMatch
	q := `
		SELECT id, COALESCE(name,''), COALESCE(asset_type,''),
		       ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
		FROM assets
		WHERE geom IS NOT NULL
		  AND asset_type IN (` + terminalContextTypes + `)
		  AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3::double precision)
		ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
		LIMIT 1`
	err := pool.QueryRow(ctx, q, lon, lat, contextMatchRadiusM).Scan(&m.ID, &m.Name, &m.Kind, &m.DistanceM)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func overlappingPortCallCount(ctx context.Context, pool *pgxpool.Pool, c Candidate) (int, error) {
	var n int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT mmsi)::int
		FROM port_call_visits
		WHERE mmsi IN ($1, $2)
		  AND tstzrange(arrival_ts, COALESCE(departure_ts, now()), '[]')
		      && tstzrange($3::timestamptz, $4::timestamptz, '[]')
	`, c.MMSIA, c.MMSIB, c.StartTS, c.EndTS).Scan(&n)
	if err != nil {
		if isUndefinedTable(err) {
			return 0, nil
		}
		return 0, err
	}
	return n, nil
}

func crowdingCount(ctx context.Context, pool *pgxpool.Pool, c Candidate) (int, error) {
	var n int
	start := c.StartTS.Add(-30 * time.Minute)
	end := c.EndTS.Add(30 * time.Minute)
	eventLat, eventLon := candidateEventPoint(c)
	err := pool.QueryRow(ctx, `
		SELECT GREATEST(COUNT(DISTINCT mmsi)::int - 2, 0)
		FROM ais_positions
		WHERE ts BETWEEN $1::timestamptz AND $2::timestamptz
		  AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5::double precision)
	`, start, end, eventLon, eventLat, crowdingRadiusM).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}

// spoofClusterVessels counts distinct vessels reporting positions inside a
// 150 m radius of the event point during the window. Hulls cannot physically
// stack like that; 4+ means GPS jamming/spoofing teleported them to one spot.
func spoofClusterVessels(ctx context.Context, pool *pgxpool.Pool, c Candidate) (int, error) {
	var n int
	eventLat, eventLon := candidateEventPoint(c)
	err := pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT mmsi)::int
		FROM ais_positions
		WHERE ts BETWEEN $1::timestamptz AND $2::timestamptz
		  AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5::double precision)
	`, c.StartTS, c.EndTS, eventLon, eventLat, spoofClusterRadiusM).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}

// maxPartnerDegree returns the max number of distinct STS partners either
// vessel accumulated in stored signals over the last 14 days.
func maxPartnerDegree(ctx context.Context, pool *pgxpool.Pool, mmsiA, mmsiB string) (int, error) {
	var n int
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(degree), 0)::int FROM (
			SELECT m, COUNT(DISTINCT partner) AS degree
			FROM (
				SELECT NULLIF(payload->>'mmsi_a','') AS m, NULLIF(payload->>'mmsi_b','') AS partner
				FROM core_signals WHERE signal_type = 'sts' AND observed_at >= now() - interval '14 days'
				UNION ALL
				SELECT NULLIF(payload->>'mmsi_b',''), NULLIF(payload->>'mmsi_a','')
				FROM core_signals WHERE signal_type = 'sts' AND observed_at >= now() - interval '14 days'
			) t
			WHERE m IN ($1, $2) AND partner IS NOT NULL
			GROUP BY m
		) d
	`, mmsiA, mmsiB).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}

// landContext reports whether the point sits on a land polygon and whether an
// inland waterway (river/lake) is nearby. A point on land away from waterways
// cannot host a real vessel — it is GPS interference or bad AIS data. Rivers
// matter because inland tanker barges (Rhine, Maas) are legitimate traffic.
func landContext(ctx context.Context, pool *pgxpool.Pool, lat, lon float64) (bool, bool, error) {
	var onLand, nearWater bool
	err := pool.QueryRow(ctx, `
		SELECT
			EXISTS (
				SELECT 1 FROM geo_reference_features
				WHERE kind = 'land'
				  AND ST_Covers(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
			),
			EXISTS (
				SELECT 1 FROM geo_reference_features
				WHERE kind IN ('river','lake')
				  AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 2000)
			)
	`, lon, lat).Scan(&onLand, &nearWater)
	if err != nil {
		if isUndefinedTable(err) {
			return false, false, nil
		}
		return false, false, err
	}
	return onLand, nearWater, nil
}

func distanceVariance(ctx context.Context, pool *pgxpool.Pool, c Candidate) (float64, error) {
	var variance float64
	err := pool.QueryRow(ctx, `
		WITH a AS (
			SELECT date_trunc('hour', ts) + (floor(extract(minute FROM ts) / 15) * 15) * interval '1 minute' AS bucket,
			       ST_Centroid(ST_Collect(geom::geometry)) AS geom
			FROM ais_positions
			WHERE mmsi = $1 AND ts BETWEEN $3::timestamptz AND $4::timestamptz
			GROUP BY 1
		),
		b AS (
			SELECT date_trunc('hour', ts) + (floor(extract(minute FROM ts) / 15) * 15) * interval '1 minute' AS bucket,
			       ST_Centroid(ST_Collect(geom::geometry)) AS geom
			FROM ais_positions
			WHERE mmsi = $2 AND ts BETWEEN $3::timestamptz AND $4::timestamptz
			GROUP BY 1
		)
		SELECT COALESCE(STDDEV_POP(ST_Distance(a.geom::geography, b.geom::geography)), 0)
		FROM a JOIN b USING (bucket)
	`, c.MMSIA, c.MMSIB, c.StartTS, c.EndTS).Scan(&variance)
	if err != nil {
		return 0, err
	}
	return variance, nil
}

func isUndefinedTable(err error) bool {
	return err != nil && (pgErrCode(err) == "42P01" || pgErrCode(err) == "42703")
}

func pgErrCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}
