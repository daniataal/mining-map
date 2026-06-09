package workers

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/services/syntheticbol"
)

// RunInferredTradeBuilder rebuilds MCR rows on an hourly schedule.
func RunInferredTradeBuilder(ctx context.Context, pool *pgxpool.Pool, log zerolog.Logger) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()
	runInferredTradeOnce(ctx, pool, log)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runInferredTradeOnce(ctx, pool, log)
		}
	}
}

func runInferredTradeOnce(ctx context.Context, pool *pgxpool.Pool, log zerolog.Logger) {
	res, err := syntheticbol.RunRebuild(ctx, pool, log)
	if err != nil {
		log.Warn().Err(err).Msg("synthetic bol build failed")
		return
	}
	if res.Upserted > 0 {
		log.Info().Int("upserted", res.Upserted).Interface("recipes", res.Recipes).Msg("synthetic bol build complete")
	}
}
