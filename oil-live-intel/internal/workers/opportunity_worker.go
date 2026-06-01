package workers

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/mining-map/oil-live-intel/internal/services/alerts"
	"github.com/mining-map/oil-live-intel/internal/services/opportunity"
)

// RunOpportunityScanner periodically detects trade opportunities and watchlist alerts.
func RunOpportunityScanner(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	ticker := time.NewTicker(1 * time.Hour)
	alertTicker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	defer alertTicker.Stop()
	runOpportunityOnce(ctx, pool, cfg, log)
	runAlertOnce(ctx, pool, cfg, log)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runOpportunityOnce(ctx, pool, cfg, log)
		case <-alertTicker.C:
			runAlertOnce(ctx, pool, cfg, log)
		}
	}
}

func runOpportunityOnce(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	n, err := opportunity.ScanRecentPortCalls(ctx, pool)
	if err != nil {
		log.Warn().Err(err).Msg("opportunity scan failed")
		return
	}
	if n > 0 {
		log.Info().Int("created", n).Msg("opportunities scanned")
		runAlertOnce(ctx, pool, cfg, log)
	}
	if u, err := opportunity.BatchRescoreOpenOpportunities(ctx, pool); err != nil {
		log.Warn().Err(err).Msg("opportunity batch rescore failed")
	} else if u > 0 {
		log.Info().Int("updated", u).Msg("opportunities rescored")
	}
}

func runAlertOnce(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	n, err := alerts.ScanRecent(ctx, pool, cfg)
	if err != nil {
		log.Warn().Err(err).Msg("alert scan failed")
		return
	}
	if n > 0 {
		log.Info().Int("fired", n).Msg("watchlist alerts")
	}
}
