package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/ingestion"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()
	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()
	ing := ingestion.New(pool, cfg)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	log.Info().Msg("madsan worker started")
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			for i := 0; i < 10; i++ {
				if !processNext(ctx, pool, ing) {
					break
				}
			}
		}
	}
}

func processNext(ctx context.Context, pool *pgxpool.Pool, ing *ingestion.Service) bool {
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		SELECT id FROM ingestion_jobs
		WHERE status = 'pending' AND scheduled_at <= now()
		ORDER BY scheduled_at LIMIT 1
		FOR UPDATE SKIP LOCKED
	`).Scan(&id)
	if err != nil {
		return false
	}
	dryRun := os.Getenv("MADSAN_DRY_RUN") == "true"
	if err := ing.ProcessJob(ctx, id, dryRun); err != nil {
		log.Error().Err(err).Str("job", id.String()).Msg("job failed")
	}
	return true
}
