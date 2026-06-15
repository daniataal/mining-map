package main

import (
	"context"
	"os"
	"strconv"

	"github.com/rs/zerolog/log"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/dedup"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()
	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()

	limit := 200
	if v := os.Getenv("MADSAN_DEDUP_SCAN_LIMIT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	names, rows, _ := dedup.ClusterSummary(ctx, pool)
	result, err := dedup.EnqueueCompanyDuplicates(ctx, pool, limit)
	if err != nil {
		log.Fatal().Err(err).Msg("enqueue failed")
	}
	log.Info().
		Int("duplicate_name_clusters", names).
		Int("extra_company_rows", rows).
		Int("review_queue_enqueued", result.Total()).
		Int("exact_name_enqueued", result.ExactNameEnqueued).
		Int("cross_name_enqueued", result.CrossNameEnqueued).
		Msg("company duplicate scan complete")
}
