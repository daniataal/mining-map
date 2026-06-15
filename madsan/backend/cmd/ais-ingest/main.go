package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/maritime/ais"
)

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	cfg := config.Load()
	if cfg.AISStreamAPIKey == "" {
		log.Fatal().Msg("AISSTREAM_API_KEY required for ais-ingest worker")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if os.Getenv("MADSAN_RUN_MIGRATIONS") != "false" {
		if err := database.RunMigrations(cfg.DatabaseURL); err != nil {
			log.Fatal().Err(err).Msg("migrations failed")
		}
	}

	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()

	log.Info().
		Int("retain_days", cfg.AISRetainDays).
		Msg("madsan ais-ingest worker started (direct AISStream → madsan_db)")

	ais.RunMaintainers(ctx, pool, cfg, log.Logger)
	ais.RunIngestor(ctx, pool, cfg, log.Logger)
}
