package workers

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/services/opportunity"
)

// RunOpportunityScanner periodically detects trade opportunities from port-call history.
func RunOpportunityScanner(ctx context.Context, pool *pgxpool.Pool, log zerolog.Logger) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()
	runOpportunityOnce(ctx, pool, log)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runOpportunityOnce(ctx, pool, log)
		}
	}
}

func runOpportunityOnce(ctx context.Context, pool *pgxpool.Pool, log zerolog.Logger) {
	n, err := opportunity.ScanRecentPortCalls(ctx, pool)
	if err != nil {
		log.Warn().Err(err).Msg("opportunity scan failed")
		return
	}
	if n > 0 {
		log.Info().Int("created", n).Msg("opportunities scanned")
	}
}
