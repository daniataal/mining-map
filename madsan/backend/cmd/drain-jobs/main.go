package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
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
		log.Fatal().Err(err).Msg("connect")
	}
	defer pool.Close()
	ing := ingestion.New(pool, cfg)
	dry := os.Getenv("MADSAN_DRY_RUN") == "true"
	max := 500
	if v := os.Getenv("MADSAN_DRAIN_MAX"); v != "" {
		fmt.Sscanf(v, "%d", &max)
	}
	done := 0
	for done < max {
		var id uuid.UUID
		err := pool.QueryRow(ctx, `
			SELECT id FROM ingestion_jobs
			WHERE status = 'pending' AND scheduled_at <= now()
			ORDER BY scheduled_at LIMIT 1
		`).Scan(&id)
		if err != nil {
			break
		}
		if err := ing.ProcessJob(ctx, id, dry); err != nil {
			log.Error().Err(err).Str("job", id.String()).Msg("failed")
		}
		done++
	}
	var pending, completed int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM ingestion_jobs WHERE status='pending'`).Scan(&pending)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM ingestion_jobs WHERE status='completed'`).Scan(&completed)
	fmt.Printf("drained %d jobs; pending=%d completed=%d\n", done, pending, completed)
	time.Sleep(100 * time.Millisecond)
}
