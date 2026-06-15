package main

import (
	"context"
	"flag"

	"github.com/rs/zerolog/log"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/maritime"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "report counts only; do not write")
	flag.Parse()

	cfg := config.Load()
	ctx := context.Background()

	madsan, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("madsan db connect")
	}
	defer madsan.Close()

	totalBefore, headingBefore, err := maritime.VesselHeadingCounts(ctx, madsan)
	if err != nil {
		log.Fatal().Err(err).Msg("count vessels")
	}
	log.Info().
		Int("total", totalBefore).
		Int("with_heading", headingBefore).
		Msg("before backfill")

	if *dryRun {
		return
	}

	if cfg.LegacyDBURL == "" {
		log.Fatal().Msg("LEGACY_DATABASE_URL not configured")
	}
	legacy, err := database.ConnectURL(ctx, cfg.LegacyDBURL)
	if err != nil {
		log.Fatal().Err(err).Msg("legacy db connect")
	}
	defer legacy.Close()

	updated, err := maritime.BackfillVesselHeading(ctx, madsan, legacy)
	if err != nil {
		log.Fatal().Err(err).Msg("backfill failed")
	}

	totalAfter, headingAfter, err := maritime.VesselHeadingCounts(ctx, madsan)
	if err != nil {
		log.Fatal().Err(err).Msg("count vessels after")
	}

	log.Info().
		Int("updated", updated).
		Int("total", totalAfter).
		Int("with_heading_before", headingBefore).
		Int("with_heading_after", headingAfter).
		Msg("vessel heading backfill complete")
}
