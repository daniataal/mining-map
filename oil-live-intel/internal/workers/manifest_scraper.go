package workers

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// RunPortManifestScraper periodically fetches public port manifests.
// Currently acts as a generic framework / stub.
func RunPortManifestScraper(ctx context.Context, pool *pgxpool.Pool, log zerolog.Logger) {
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()

	l := log.With().Str("worker", "manifest_scraper").Logger()
	l.Info().Msg("started port manifest scraper worker")

	for {
		select {
		case <-ctx.Done():
			l.Info().Msg("stopping port manifest scraper worker")
			return
		case <-ticker.C:
			// STUB: Here we would fetch from a specific provider API or scrape HTML
			// e.g., US Customs, European Port Authorities.
			l.Info().Msg("running periodic port manifest scraping cycle (stub)")
			
			// In the future:
			// 1. Fetch data
			// 2. Parse IMO, vessel name, load/discharge ports, cargo type
			// 3. Insert into port_manifests table
			// 4. Update the graphify-out layer
			
			/*
			_, err := pool.Exec(ctx, `
				INSERT INTO port_manifests (vessel_imo, vessel_name, load_port, discharge_port, cargo_type, provider)
				VALUES ($1, $2, $3, $4, $5, $6)
			`, "1234567", "TEST VESSEL", "Rotterdam", "Houston", "Crude Oil", "StubProvider")
			if err != nil {
				l.Error().Err(err).Msg("failed to insert scraped manifest")
			}
			*/
		}
	}
}
