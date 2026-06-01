package workers

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/mining-map/oil-live-intel/internal/services/trade"
)

// RunTradeSync periodically fetches Comtrade (public/keyed), EIA, and seed into oil_trade_flows.
func RunTradeSync(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
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
	if !cfg.EnableComtrade && !cfg.EnableEIA {
		log.Info().Msg("trade sync disabled (ENABLE_COMTRADE and ENABLE_EIA off)")
		return
	}
	n, _ := trade.CountRows(ctx, pool)
	if n == 0 {
		log.Info().Msg("oil_trade_flows empty — running full trade sync")
	}
	res, err := trade.RunSync(ctx, pool, cfg, log)
	if err != nil {
		log.Warn().Err(err).Msg("trade sync failed")
		return
	}
	if res.RowsUpserted > 0 || len(res.Errors) > 0 {
		log.Info().
			Int("rows", res.RowsUpserted).
			Interface("sources", res.Sources).
			Int("errors", len(res.Errors)).
			Msg("trade sync complete")
	}
}
