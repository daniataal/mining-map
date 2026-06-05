package workers

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/mining-map/oil-live-intel/internal/services/gfw"
)

const gfwRegionPause = 15 * time.Second

// RunGFWArchiveIngest periodically backfills oil_ais_track_points from GFW AIS presence.
func RunGFWArchiveIngest(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	if !cfg.GFWArchiveIngestEnabled {
		log.Info().Msg("[gfw-archive] disabled")
		return
	}
	if cfg.GFWAPIKey == "" {
		log.Warn().Msg("[gfw-archive] idle: GFW_API_KEY not set")
		return
	}

	interval := time.Duration(cfg.GFWArchiveIngestIntervalHours) * time.Hour
	if interval < time.Hour {
		interval = 24 * time.Hour
	}

	runOnce := func() {
		if err := runGFWArchiveIngestOnce(ctx, pool, cfg, log); err != nil {
			log.Warn().Err(err).Msg("[gfw-archive] pass failed")
		}
	}

	runOnce()
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
			runOnce()
		}
	}
}

func runGFWArchiveIngestOnce(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) error {
	client := gfw.New(cfg.GFWAPIKey)
	days := cfg.GFWArchiveBackfillDays
	if days <= 0 {
		days = 7
	}
	// GFW presence lags ~96h; end window before that cutoff.
	to := time.Now().UTC().Add(-96 * time.Hour)
	from := to.Add(-time.Duration(days) * 24 * time.Hour)

	var totalFetched, totalWritten int
	for i, bbox := range gfw.DefaultArchiveRegions() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if i > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(gfwRegionPause):
			}
		}
		pts, err := client.FetchBBoxTrackPoints(ctx, bbox, from, to, 0)
		if err != nil {
			if err == gfw.ErrRateLimited {
				log.Warn().Str("region", bbox.Name).Msg("[gfw-archive] rate limited; retry next interval")
				return nil
			}
			return err
		}
		written, err := gfw.UpsertTrackPoints(ctx, pool, pts)
		if err != nil {
			return err
		}
		totalFetched += len(pts)
		totalWritten += written
		log.Info().
			Str("region", bbox.Name).
			Int("fetched", len(pts)).
			Int("inserted", written).
			Time("from", from).
			Time("to", to).
			Msg("[gfw-archive] region complete")
	}
	log.Info().
		Int("fetched", totalFetched).
		Int("inserted", totalWritten).
		Int("backfill_days", days).
		Msg("[gfw-archive] pass complete")
	return nil
}
