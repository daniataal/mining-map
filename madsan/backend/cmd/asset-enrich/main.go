package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/ingestion"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "reconcile but do not write asset_enrichment")
	force := flag.Bool("force", false, "re-enrich even when asset_enrichment row is fresh")
	limit := flag.Int("limit", 0, "max assets per run (default 100)")
	legacyID := flag.String("legacy-id", "", "enrich a single asset by legacy_id (petroleum_osm_features id or oil_terminals uuid)")
	assetID := flag.String("asset-id", "", "enrich a single asset by madsan assets.id uuid")
	quiet := flag.Bool("quiet", false, "suppress per-asset and periodic progress logs")
	flag.Parse()

	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	config.LoadDeployEnv()
	cfg := config.Load()
	ctx := context.Background()
	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()

	result, err := ingestion.RunAssetEnrichmentBatch(ctx, pool, cfg, log.Logger, ingestion.AssetEnrichBatchOptions{
		Limit:    *limit,
		Force:    *force,
		DryRun:   *dryRun,
		LegacyID: *legacyID,
		AssetID:  *assetID,
		Quiet:    *quiet,
	})
	if err != nil {
		log.Fatal().Err(err).Msg("asset enrichment failed")
	}

	fmt.Printf("enriched=%d skipped=%d relationships=%d evidence=%d errors=%d dry_run=%v\n",
		result.Enriched, result.Skipped, result.Relationships, result.Evidence, len(result.Errors), *dryRun)
	for _, e := range result.Errors {
		fmt.Fprintf(os.Stderr, "error: %s\n", e)
	}
	if len(result.Errors) > 0 && result.Enriched == 0 {
		os.Exit(1)
	}
}
