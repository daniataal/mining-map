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
	dryRun := flag.Bool("dry-run", false, "fetch from ShipVault but do not write madsan_db")
	force := flag.Bool("force", false, "re-enrich even when vessel_enrichment row is fresh")
	limit := flag.Int("limit", 0, "max vessels per run (default MADSAN_VESSEL_ENRICHMENT_BATCH)")
	imo := flag.String("imo", "", "enrich a single vessel by IMO (e.g. 9599377 for LERRIX)")
	flag.Parse()

	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	cfg := config.Load()
	ctx := context.Background()
	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()

	result, err := ingestion.RunVesselEnrichmentBatch(ctx, pool, cfg, log.Logger, ingestion.VesselEnrichBatchOptions{
		Limit:  *limit,
		Force:  *force,
		IMO:    *imo,
		DryRun: *dryRun,
	})
	if err != nil {
		log.Fatal().Err(err).Msg("vessel enrichment failed")
	}

	fmt.Printf("enriched=%d skipped=%d uncertain=%d errors=%d dry_run=%v\n",
		result.Enriched, result.Skipped, result.Uncertain, len(result.Errors), *dryRun)
	for _, e := range result.Errors {
		fmt.Fprintf(os.Stderr, "error: %s\n", e)
	}
	if len(result.Errors) > 0 && result.Enriched == 0 {
		os.Exit(1)
	}
}
