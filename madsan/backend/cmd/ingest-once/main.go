package main

import (
	"context"
	"fmt"
	"os"

	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/ingestion"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()
	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "connect: %v\n", err)
		os.Exit(1)
	}
	defer pool.Close()
	ing := ingestion.New(pool, cfg)

	jobType := env("MADSAN_JOB_TYPE", "bunker_seed")
	source := env("MADSAN_SOURCE_SLUG", "bunker_fuel_suppliers")

	var id uuid.UUID
	err = pool.QueryRow(ctx, `
		INSERT INTO ingestion_jobs (job_type, source_slug, status, payload, scheduled_at)
		VALUES ($1,$2,'pending','{}'::jsonb, now()) RETURNING id
	`, jobType, source).Scan(&id)
	if err != nil {
		fmt.Fprintf(os.Stderr, "enqueue: %v\n", err)
		os.Exit(1)
	}
	if err := ing.ProcessJob(ctx, id, false); err != nil {
		fmt.Fprintf(os.Stderr, "process: %v\n", err)
		os.Exit(1)
	}
	var companies int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM companies`).Scan(&companies)
	fmt.Printf("job %s done, companies=%d\n", id, companies)
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
