package workers

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/broadcast"
	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/mining-map/oil-live-intel/internal/services/ais"
	"github.com/mining-map/oil-live-intel/internal/services/geofence"
	"github.com/mining-map/oil-live-intel/internal/services/portcall"
)

const (
	terminalBufferDeg   = 0.45
	geofenceRadiusM     = 1200
	positionMinInterval = 90 * time.Second
)

// RunAISIngestor streams AIS, persists tankers, and runs port-call detection.
func RunAISIngestor(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	if !cfg.EnableAIS {
		log.Info().Msg("ais ingestor disabled")
		return
	}

	for {
		if ctx.Err() != nil {
			return
		}
		if err := runAISCycle(ctx, pool, cfg, log); err != nil {
			log.Warn().Err(err).Msg("ais cycle failed; retry in 30s")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
		}
	}
}

func runAISCycle(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) error {
	index, err := geofence.Load(ctx, pool, geofenceRadiusM)
	if err != nil {
		return err
	}
	if index.Count() == 0 {
		log.Warn().Msg("ais ingestor waiting for oil_terminals")
		return nil
	}

	lats, lons, err := loadTerminalCoords(ctx, pool)
	if err != nil {
		return err
	}
	boxes := ais.BuildTerminalBoxes(lats, lons, terminalBufferDeg)
	log.Info().Int("terminals", index.Count()).Int("boxes", len(boxes)).Msg("ais ingestor subscribing")

	tracker := portcall.NewTracker(pool, index)
	sub := ais.Subscription{APIKey: cfg.AISStreamAPIKey, BoundingBoxes: boxes}

	cycleCtx, cancel := context.WithTimeout(ctx, 20*time.Minute)
	defer cancel()

	return ais.RunStreamWithTLSFallback(cycleCtx, sub, func(ctx context.Context, u *ais.Update) error {
		term := index.Match(u.Lat, u.Lon)
		nearSulfur := term != nil && term.HasSulfur
		if !ais.IsRelevantVessel(u.ShipTypeCode, u.ShipTypeLabel, u.Name, nearSulfur) {
			return nil
		}
		tclass := ais.TankerClass(u.ShipTypeCode, u.ShipTypeLabel, u.Name)
		if err := ais.PersistVessel(ctx, pool, u, tclass); err != nil {
			return err
		}
		if inserted, err := ais.PersistPosition(ctx, pool, u, positionMinInterval); err != nil {
			return err
		} else if inserted {
			broadcast.Post(cfg, "vessel_position", map[string]any{
				"mmsi": u.MMSI, "lat": u.Lat, "lng": u.Lon, "name": u.Name, "tanker_class": tclass, "ts": u.Timestamp,
			})
		}

		var dwt, maxDraft float64
		_ = pool.QueryRow(ctx, `SELECT COALESCE(deadweight_tons,0), COALESCE(max_draft_m,16) FROM oil_vessels WHERE mmsi=$1`, u.MMSI).Scan(&dwt, &maxDraft)
		crude := tclass == "crude"
		product := tclass == "product" || tclass == "chemical"
		card, err := tracker.HandlePosition(ctx, u, tclass, crude, product, dwt, maxDraft)
		if err != nil {
			return err
		}
		if card != nil {
			log.Info().Str("title", card.Title).Str("id", card.ID.String()).Msg("intelligence card created")
			broadcast.Post(cfg, "intelligence_card_created", map[string]any{
				"id": card.ID.String(), "title": card.Title, "event_type": card.EventType,
			})
		}
		return nil
	}, cfg.AISInsecureTLS, cfg.AISAutoTLSFallback)
}

func loadTerminalCoords(ctx context.Context, pool *pgxpool.Pool) (lats, lons []float64, err error) {
	rows, err := pool.Query(ctx, `SELECT ST_Y(geom::geometry), ST_X(geom::geometry) FROM oil_terminals WHERE geom IS NOT NULL`)
	if err != nil {
		return nil, nil, err
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

// RunPortCallMaintainer periodically closes stale open port calls.
func RunPortCallMaintainer(ctx context.Context, pool *pgxpool.Pool, log zerolog.Logger) {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			index, err := geofence.Load(ctx, pool, geofenceRadiusM)
			if err != nil {
				continue
			}
			n, err := portcall.CloseStaleOpenCalls(ctx, pool, index)
			if err != nil {
				log.Warn().Err(err).Msg("stale port call sweep failed")
			} else if n > 0 {
				log.Info().Int("closed", n).Msg("closed stale open port calls")
			}
		}
	}
}

// RunPositionCleanup deletes old AIS positions.
func RunPositionCleanup(ctx context.Context, pool *pgxpool.Pool, retainHours int, log zerolog.Logger) {
	if retainHours <= 0 {
		retainHours = 72
	}
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, err := pool.Exec(ctx, `DELETE FROM oil_ais_positions WHERE ts < now() - ($1 || ' hours')::interval`, retainHours)
			if err != nil {
				log.Warn().Err(err).Msg("ais position cleanup failed")
			}
		}
	}
}
