package main

import (
	"context"
	"os"
	"strconv"

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

	limit := 15000
	if v := os.Getenv("MADSAN_REL_BACKFILL_LIMIT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	linked, rels, err := ingestion.BackfillRelationships(ctx, pool, limit)
	if err != nil {
		log.Fatal().Err(err).Msg("backfill failed")
	}
	log.Info().Int("assets_linked", linked).Int("relationships", rels).Msg("relationship backfill complete")
}
