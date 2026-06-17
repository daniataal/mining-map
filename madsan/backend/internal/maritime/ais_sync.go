package maritime

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/intelligence"
)

// VesselDelta is a live AIS position update broadcast to map clients.
type VesselDelta struct {
	MMSI        string    `json:"mmsi"`
	Name        string    `json:"name,omitempty"`
	VesselType  string    `json:"vessel_type,omitempty"`
	Lat         float64   `json:"lat"`
	Lon         float64   `json:"lon"`
	Course         *float64 `json:"course,omitempty"`
	Heading        *float64 `json:"heading,omitempty"`
	SpeedKnots     *float64 `json:"speed_knots,omitempty"`
	InferredCourse *float64 `json:"inferred_course,omitempty"`
	Destination string    `json:"destination,omitempty"`
	LastSeenAt  time.Time `json:"last_seen_at"`
	Source      string    `json:"source"`
}

type Syncer struct {
	madsan  *pgxpool.Pool
	legacy  *pgxpool.Pool
	log     zerolog.Logger
	since   time.Time
	stats   *SyncStats
	onDelta func(VesselDelta)
}

func NewSyncer(madsan, legacy *pgxpool.Pool, log zerolog.Logger, lookback time.Duration) *Syncer {
	return &Syncer{
		madsan: madsan,
		legacy: legacy,
		log:    log,
		since:  initialAISSince(time.Now(), lookback),
	}
}

// initialAISSince is the first SyncOnce watermark: legacy rows with ts > since are imported.
// Default lookback is 7d so stale legacy AIS is not skipped on cold start.
func initialAISSince(now time.Time, lookback time.Duration) time.Time {
	if lookback <= 0 {
		lookback = 168 * time.Hour
	}
	return now.Add(-lookback)
}

func (s *Syncer) SetStats(stats *SyncStats) {
	s.stats = stats
}

func (s *Syncer) OnDelta(fn func(VesselDelta)) {
	s.onDelta = fn
}

func (s *Syncer) Run(ctx context.Context, interval time.Duration) {
	if s.legacy == nil {
		s.log.Warn().Msg("ais sync disabled: no legacy database")
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	s.log.Info().Dur("interval", interval).Msg("ais sync started")
	for {
		if err := s.SyncOnce(ctx); err != nil {
			s.log.Warn().Err(err).Msg("ais sync batch failed")
			if s.stats != nil {
				s.stats.RecordError(err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Syncer) SyncOnce(ctx context.Context) error {
	rows, err := s.legacy.Query(ctx, `
		SELECT DISTINCT ON (p.mmsi)
			p.mmsi::text,
			COALESCE(v.name, ''),
			COALESCE(v.vessel_type, v.tanker_class, 'Tanker'),
			p.lat,
			p.lon,
			p.speed,
			p.course,
			p.heading,
			COALESCE(p.destination, ''),
			p.ts
		FROM oil_ais_positions p
		JOIN oil_vessels v ON v.mmsi = p.mmsi
		WHERE p.ts > $1
		  AND p.lat IS NOT NULL AND p.lon IS NOT NULL
		ORDER BY p.mmsi, p.ts DESC
		LIMIT 2000
	`, s.since)
	if err != nil {
		return fmt.Errorf("legacy ais query: %w", err)
	}
	defer rows.Close()

	var maxTS time.Time
	updated := 0
	linksCreated := 0
	for rows.Next() {
		var d VesselDelta
		var speed, course, heading *float64
		if err := rows.Scan(&d.MMSI, &d.Name, &d.VesselType, &d.Lat, &d.Lon, &speed, &course, &heading, &d.Destination, &d.LastSeenAt); err != nil {
			return err
		}
		d.SpeedKnots = speed
		d.Course = course
		d.Heading = heading
		d.Source = "legacy_oil_ais_positions"
		SanitizeVesselDelta(&d)
		if d.LastSeenAt.After(maxTS) {
			maxTS = d.LastSeenAt
		}
		vesselID, fresh, err := s.upsertVessel(ctx, d)
		if err != nil {
			s.log.Debug().Err(err).Str("mmsi", d.MMSI).Msg("vessel upsert skipped")
			continue
		}
		if fresh {
			if err := intelligence.PersistVesselAIS(ctx, s.madsan, vesselID, d.LastSeenAt, d.SpeedKnots, 65); err != nil {
				s.log.Debug().Err(err).Str("mmsi", d.MMSI).Msg("ais signal persist skipped")
			}
			if n, err := LinkVesselProximities(ctx, s.madsan, vesselID, d.MMSI, d.Destination, &d.Lat, &d.Lon); err != nil {
				s.log.Debug().Err(err).Str("mmsi", d.MMSI).Msg("vessel proximity link skipped")
			} else {
				linksCreated += n
			}
		}
		updated++
		if s.onDelta != nil {
			s.onDelta(d)
		}
	}
	if !maxTS.IsZero() {
		s.since = maxTS
	}
	if s.stats != nil {
		s.stats.RecordSuccess(updated)
	}
	if updated > 0 {
		s.log.Info().Int("updated", updated).Int("terminal_links", linksCreated).Time("since", s.since).Msg("ais sync batch")
	}
	return rows.Err()
}

func (s *Syncer) upsertVessel(ctx context.Context, d VesselDelta) (uuid.UUID, bool, error) {
	var id uuid.UUID
	var positionFresh bool
	err := s.madsan.QueryRow(ctx, `
		INSERT INTO vessels (name, mmsi, vessel_type, latitude, longitude, geom, course, heading, speed_knots, destination, last_seen_at, confidence_score, data_quality_status)
		VALUES ($1,$2,$3,$4,$5, ST_SetSRID(ST_MakePoint($5,$4),4326)::geography, $6,$7,$8,$9,$10, 65, 'observed')
		ON CONFLICT (mmsi) DO UPDATE SET
			name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE vessels.name END,
			vessel_type = COALESCE(NULLIF(EXCLUDED.vessel_type,''), vessels.vessel_type),
			latitude = CASE WHEN EXCLUDED.last_seen_at >= COALESCE(vessels.last_seen_at, 'epoch'::timestamptz) THEN EXCLUDED.latitude ELSE vessels.latitude END,
			longitude = CASE WHEN EXCLUDED.last_seen_at >= COALESCE(vessels.last_seen_at, 'epoch'::timestamptz) THEN EXCLUDED.longitude ELSE vessels.longitude END,
			geom = CASE WHEN EXCLUDED.last_seen_at >= COALESCE(vessels.last_seen_at, 'epoch'::timestamptz) THEN EXCLUDED.geom ELSE vessels.geom END,
			course = CASE
				WHEN EXCLUDED.last_seen_at >= COALESCE(vessels.last_seen_at, 'epoch'::timestamptz) THEN EXCLUDED.course
				WHEN vessels.course IS NULL AND EXCLUDED.course IS NOT NULL THEN EXCLUDED.course
				ELSE vessels.course
			END,
			heading = CASE
				WHEN EXCLUDED.last_seen_at >= COALESCE(vessels.last_seen_at, 'epoch'::timestamptz) THEN EXCLUDED.heading
				WHEN vessels.heading IS NULL AND EXCLUDED.heading IS NOT NULL THEN EXCLUDED.heading
				ELSE vessels.heading
			END,
			speed_knots = CASE WHEN EXCLUDED.last_seen_at >= COALESCE(vessels.last_seen_at, 'epoch'::timestamptz) THEN EXCLUDED.speed_knots ELSE vessels.speed_knots END,
			destination = CASE WHEN EXCLUDED.last_seen_at >= COALESCE(vessels.last_seen_at, 'epoch'::timestamptz) THEN EXCLUDED.destination ELSE vessels.destination END,
			last_seen_at = GREATEST(COALESCE(vessels.last_seen_at, EXCLUDED.last_seen_at), EXCLUDED.last_seen_at),
			updated_at = now()
		RETURNING id, (last_seen_at = $10::timestamptz) AS position_fresh
	`, d.Name, d.MMSI, d.VesselType, d.Lat, d.Lon, d.Course, d.Heading, d.SpeedKnots, d.Destination, d.LastSeenAt).Scan(&id, &positionFresh)
	return id, positionFresh, err
}

// LivePositionMaxAge is the AIS freshness window for the map live overlay.
const LivePositionMaxAge = 12 * time.Hour

// Snapshot returns vessels inside a viewport bbox [west, south, east, north].
func Snapshot(ctx context.Context, pool *pgxpool.Pool, bbox [4]float64, limit int) ([]VesselDelta, error) {
	return snapshot(ctx, pool, bbox, limit, 72*time.Hour)
}

// SnapshotLive returns vessels with AIS fixes fresh enough for the live map overlay.
func SnapshotLive(ctx context.Context, pool *pgxpool.Pool, bbox [4]float64, limit int) ([]VesselDelta, error) {
	return snapshot(ctx, pool, bbox, limit, LivePositionMaxAge)
}

func snapshot(ctx context.Context, pool *pgxpool.Pool, bbox [4]float64, limit int, maxAge time.Duration) ([]VesselDelta, error) {
	if limit <= 0 {
		limit = 500
	}
	if limit > 5000 {
		limit = 5000
	}
	if maxAge <= 0 {
		maxAge = LivePositionMaxAge
	}
	west, south, east, north := bbox[0], bbox[1], bbox[2], bbox[3]
	rows, err := pool.Query(ctx, `
		SELECT v.mmsi, COALESCE(v.name,''), COALESCE(v.vessel_type,''), v.latitude, v.longitude,
		       v.course, v.heading, v.speed_knots,
		       COALESCE(v.destination,''), COALESCE(v.last_seen_at, now()),
		       track.inferred_course
		FROM vessels v
		`+VesselTrackBearingLateralSQL+`
		WHERE v.latitude IS NOT NULL AND v.longitude IS NOT NULL
		  AND v.longitude BETWEEN $1 AND $2
		  AND v.latitude BETWEEN $3 AND $4
		  AND v.last_seen_at > now() - $5::interval
		ORDER BY v.last_seen_at DESC NULLS LAST
		LIMIT $6
	`, west, east, south, north, maxAge.String(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VesselDelta
	for rows.Next() {
		var d VesselDelta
		var speed, course, heading, inferred *float64
		if err := rows.Scan(&d.MMSI, &d.Name, &d.VesselType, &d.Lat, &d.Lon, &course, &heading, &speed, &d.Destination, &d.LastSeenAt, &inferred); err != nil {
			return nil, err
		}
		d.Course = course
		d.Heading = heading
		d.SpeedKnots = speed
		d.InferredCourse = inferred
		d.Source = "madsan_vessels"
		SanitizeVesselDelta(&d)
		out = append(out, d)
	}
	return out, rows.Err()
}

func InBBox(lat, lon float64, bbox [4]float64) bool {
	return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
}
