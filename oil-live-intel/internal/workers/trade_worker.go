package workers

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/config"
)

// RunTradeSync periodically fetches EIA/Comtrade macro flows when keys are set.
func RunTradeSync(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	if !cfg.EnableEIA && !cfg.EnableComtrade {
		log.Info().Msg("trade sync disabled")
		return
	}
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	runTradeOnce(ctx, pool, cfg, log)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runTradeOnce(ctx, pool, cfg, log)
		}
	}
}

func runTradeOnce(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	if cfg.EnableEIA && cfg.EIAAPIKey != "" {
		log.Info().Msg("eia sync placeholder — wire petroleum series in follow-up")
	}
	if cfg.EnableComtrade && cfg.ComtradeAPIKey != "" {
		log.Info().Msg("comtrade sync placeholder — HS 2709/2710/2711/2802 in follow-up")
	}
	_ = pool
}
