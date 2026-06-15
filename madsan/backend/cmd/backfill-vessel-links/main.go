package main

import (
	"context"
	"os"
	"strconv"

	"github.com/rs/zerolog/log"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/maritime"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()
	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()

	limit := 5000
	if v := os.Getenv("MADSAN_VESSEL_LINK_LIMIT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	n, err := maritime.BackfillVesselLinks(ctx, pool, limit)
	if err != nil {
		log.Fatal().Err(err).Msg("backfill failed")
	}
	log.Info().Int("links_created", n).Msg("vessel-terminal link backfill complete")
}
