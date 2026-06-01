// oil-live-search-indexer maintains the Elasticsearch indices for the four
// canonical entity tables (meridian_cargo_records, oil_companies,
// oil_terminals, oil_vessels).
//
// On boot it does a full sync of every row, then loops on a ticker doing an
// incremental sync of rows touched since the last run. Cursors live in
// memory; restarting the worker triggers a fresh full sync.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/mining-map/oil-live-intel/internal/db"
	"github.com/mining-map/oil-live-intel/internal/services/search"
	"github.com/mining-map/oil-live-intel/internal/utils"
)

func main() {
	cfg := config.Load()
	log := utils.NewLogger().With().Str("component", "search-indexer").Logger()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("database connect failed")
	}
	defer pool.Close()

	client, err := search.NewClient(cfg.ElasticsearchURL)
	if err != nil {
		log.Fatal().Err(err).Str("url", cfg.ElasticsearchURL).Msg("search client init failed")
	}

	// Wait for ES to be reachable. We block here so the indexer doesn't
	// run before ES is up; "depends_on" in compose gates us further.
	waitForElasticsearch(ctx, client, log)

	if err := search.EnsureIndices(ctx, client); err != nil {
		log.Error().Err(err).Msg("ensure indices failed (will retry on next tick)")
	}

	interval := time.Duration(cfg.SearchIndexerInterval) * time.Second
	if interval < 10*time.Second {
		interval = 10 * time.Second
	}
	log.Info().
		Str("elasticsearch_url", cfg.ElasticsearchURL).
		Dur("interval", interval).
		Msg("oil-live-search-indexer starting full sync")

	cursors := &search.Cursors{}
	runOnce(ctx, pool, client, cursors, false, log)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	for {
		select {
		case <-stop:
			log.Info().Msg("shutdown requested")
			return
		case <-ticker.C:
			runOnce(ctx, pool, client, cursors, true, log)
		}
	}
}

func runOnce(ctx context.Context, pool *pgxpool.Pool, client search.Client, cursors *search.Cursors, incremental bool, log zerolog.Logger) {
	start := time.Now()
	stats, err := search.SyncAll(ctx, pool, client, 500, cursors, incremental)
	if err != nil {
		log.Error().Err(err).Bool("incremental", incremental).Msg("indexer pass failed")
		return
	}
	for _, s := range stats {
		ev := log.Info().
			Str("index", s.Index).
			Bool("incremental", incremental).
			Int("fetched", s.Fetched).
			Int("indexed", s.Indexed).
			Int("failed", s.Failed)
		if len(s.Errors) > 0 {
			first := s.Errors[0]
			ev = ev.Str("first_err_id", first.ID).Str("first_err_reason", first.Reason)
		}
		ev.Msg("index pass complete")
	}
	log.Info().Dur("elapsed", time.Since(start)).Msg("indexer pass done")
}

// waitForElasticsearch polls ES Ping until it succeeds or ctx is cancelled.
// Backs off up to 30s between attempts.
func waitForElasticsearch(ctx context.Context, c search.Client, log zerolog.Logger) {
	delay := time.Second
	for {
		if err := search.PingWithTimeout(ctx, c, 3*time.Second); err == nil {
			log.Info().Msg("elasticsearch reachable")
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		if delay < 30*time.Second {
			delay *= 2
		}
	}
}
