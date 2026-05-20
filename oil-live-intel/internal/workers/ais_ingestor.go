package workers

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/config"
)

// RunAISIngestor connects to AISStream when enabled; full geofence pipeline in phase 7–8.
func RunAISIngestor(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	if !cfg.EnableAIS {
		log.Info().Msg("ais ingestor disabled (no key or ENABLE_AIS=false)")
		return
	}
	var terminalCount int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_terminals WHERE geom IS NOT NULL`).Scan(&terminalCount)
	if terminalCount == 0 {
		log.Warn().Msg("ais ingestor waiting for oil_terminals before subscribing")
		return
	}
	log.Info().Int("terminals", terminalCount).Msg("ais ingestor ready (live websocket wiring in next iteration)")
	<-ctx.Done()
}
