package ais

import (
	"context"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/maritime/geofence"
	"github.com/madsan/intelligence/internal/maritime/portcall"
)

const (
	defaultTerminalBufferDeg = 0.45
	defaultGeofenceRadiusM   = 1200
	defaultPositionInterval  = 90 * time.Second
	minReconnectDelay        = 5 * time.Second
	maxReconnectDelay        = 60 * time.Second
)

// RunIngestor streams AISStream into madsan_db.ais_positions and vessels; detects port calls.
func RunIngestor(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	if cfg.AISStreamAPIKey == "" {
		log.Info().Msg("ais ingest disabled: AISSTREAM_API_KEY missing")
		return
	}
	reconnectDelay := minReconnectDelay
	for {
		if ctx.Err() != nil {
			return
		}
		if err := runCycle(ctx, pool, cfg, log); err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Warn().Err(err).Dur("retry_in", reconnectDelay).Msg("ais ingest cycle failed")
			_ = UpdateSourceHealth(ctx, pool, 0, err)
		} else {
			reconnectDelay = minReconnectDelay
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(reconnectDelay):
		}
		if reconnectDelay < maxReconnectDelay {
			reconnectDelay *= 2
			if reconnectDelay > maxReconnectDelay {
				reconnectDelay = maxReconnectDelay
			}
		}
	}
}

func runCycle(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) error {
	radiusM := cfg.AISGeofenceRadiusM
	if radiusM <= 0 {
		radiusM = defaultGeofenceRadiusM
	}
	index, err := geofence.Load(ctx, pool, radiusM)
	if err != nil {
		return err
	}
	if index.Count() == 0 {
		log.Warn().Msg("ais ingest waiting for terminal/port assets with geometry")
		return nil
	}

	lats, lons, err := LoadAssetCoords(ctx, pool)
	if err != nil {
		return err
	}
	bufferDeg := cfg.AISTerminalBufferDeg
	if bufferDeg <= 0 {
		bufferDeg = defaultTerminalBufferDeg
	}
	boxes := BuildTerminalBoxes(lats, lons, bufferDeg)
	log.Info().
		Int("assets", index.Count()).
		Int("subscription_boxes", len(boxes)).
		Msg("ais ingest subscribing to AISStream")

	tracker := portcall.NewTracker(pool, index)
	sub := Subscription{APIKey: cfg.AISStreamAPIKey, BoundingBoxes: boxes}

	minInterval := time.Duration(cfg.AISPositionMinIntervalSec) * time.Second
	if minInterval <= 0 {
		minInterval = defaultPositionInterval
	}

	cycleCtx := ctx
	cancel := func() {}
	if cfg.AISCycleMinutes > 0 {
		cycleCtx, cancel = context.WithTimeout(ctx, time.Duration(cfg.AISCycleMinutes)*time.Minute)
	}
	defer cancel()

	_ = UpdateSourceHealth(cycleCtx, pool, 0, nil)

	var frameCount int
	lastHealth := time.Now()

	return RunStreamWithTLSFallback(cycleCtx, sub, func(ctx context.Context, u *Update) error {
		frameCount++
		if time.Since(lastHealth) > 15*time.Second {
			_ = UpdateSourceHealth(ctx, pool, frameCount, nil)
			frameCount = 0
			lastHealth = time.Now()
		}

		asset := index.Match(u.Lat, u.Lon)
		nearSulfur := asset != nil && asset.HasSulfur
		if !IsRelevantVessel(u.ShipTypeCode, u.ShipTypeLabel, u.Name, nearSulfur) {
			return nil
		}
		tclass := TankerClass(u.ShipTypeCode, u.ShipTypeLabel, u.Name)
		vesselID, fresh, err := UpsertVessel(ctx, pool, u, tclass)
		if err != nil {
			log.Warn().Err(err).Int64("mmsi", u.MMSI).Msg("ais vessel upsert skipped")
			return nil
		}
		if fresh && u.HasKinematics {
			if err := notifyVesselDelta(ctx, pool, u, tclass); err != nil {
				log.Warn().Err(err).Int64("mmsi", u.MMSI).Msg("ais live notify failed")
			}
		}
		if u.HasKinematics {
			if _, err := PersistPosition(ctx, pool, u, minInterval); err != nil {
				log.Warn().Err(err).Int64("mmsi", u.MMSI).Msg("ais position persist skipped")
			}
			if err := tracker.HandlePosition(ctx, vesselID, toPortCallPosition(u), tclass); err != nil {
				log.Warn().Err(err).Int64("mmsi", u.MMSI).Msg("ais port call track skipped")
			}
		}
		return nil
	}, cfg.AISInsecureTLS, cfg.AISAutoTLSFallback)
}

// RunMaintainers runs port-call stale closer and ais_positions retention purge.
func RunMaintainers(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	go runPortCallMaintainer(ctx, pool, cfg, log)
	go runRetentionCleanup(ctx, pool, cfg, log)
}

func runPortCallMaintainer(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	radiusM := cfg.AISGeofenceRadiusM
	if radiusM <= 0 {
		radiusM = defaultGeofenceRadiusM
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			index, err := geofence.Load(ctx, pool, radiusM)
			if err != nil {
				continue
			}
			n, err := portcall.CloseStaleOpenVisits(ctx, pool, index)
			if err != nil {
				log.Warn().Err(err).Msg("stale port call sweep failed")
			} else if n > 0 {
				log.Info().Int("closed", n).Msg("closed stale open port calls")
			}
		}
	}
}

func runRetentionCleanup(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	retainDays := cfg.AISRetainDays
	if retainDays <= 0 {
		retainDays = 30
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			n, err := PurgeOldPositions(ctx, pool, retainDays)
			if err != nil {
				log.Warn().Err(err).Msg("ais position retention purge failed")
			} else if n > 0 {
				log.Info().Int64("deleted", n).Int("retain_days", retainDays).Msg("ais position retention purge")
			}
		}
	}
}

// SweepRecentPositions batch-detects port calls from recent ais_positions via ST_DWithin (worker hook).
func SweepRecentPositions(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, hours int) (int, error) {
	if hours <= 0 {
		hours = 6
	}
	radiusM := cfg.AISGeofenceRadiusM
	if radiusM <= 0 {
		radiusM = defaultGeofenceRadiusM
	}
	rows, err := pool.Query(ctx, `
		SELECT DISTINCT ON (p.mmsi)
			p.mmsi, p.lat, p.lon, p.ts,
			COALESCE(p.speed_knots, 0), COALESCE(p.course, 0), COALESCE(p.heading, 0),
			COALESCE(p.destination,''), COALESCE(p.draft_m, 0), p.draft_m IS NOT NULL,
			COALESCE(v.id, '00000000-0000-0000-0000-000000000000'::uuid)
		FROM ais_positions p
		LEFT JOIN vessels v ON v.mmsi = p.mmsi
		WHERE p.ts > now() - ($1::int * INTERVAL '1 hour')
		ORDER BY p.mmsi, p.ts DESC
	`, hours)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	index, err := geofence.Load(ctx, pool, radiusM)
	if err != nil {
		return 0, err
	}
	tracker := portcall.NewTracker(pool, index)
	processed := 0
	for rows.Next() {
		var mmsi, dest string
		var lat, lon, speed, course, heading, draft float64
		var ts time.Time
		var hasDraft bool
		var vesselID uuid.UUID
		if err := rows.Scan(&mmsi, &lat, &lon, &ts, &speed, &course, &heading, &dest, &draft, &hasDraft, &vesselID); err != nil {
			return processed, err
		}
		mmsiInt, _ := strconv.ParseInt(mmsi, 10, 64)
		if mmsiInt <= 0 {
			continue
		}
		u := &Update{
			MMSI: mmsiInt, Lat: lat, Lon: lon, Speed: speed, Course: course, Heading: heading,
			Destination: dest, DraftM: draft, HasDraft: hasDraft, Timestamp: ts,
		}
		if err := tracker.HandlePosition(ctx, vesselID, toPortCallPosition(u), TankerClass(0, "", "")); err != nil {
			return processed, err
		}
		processed++
	}
	return processed, rows.Err()
}
