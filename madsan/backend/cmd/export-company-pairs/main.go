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

	clusterLimit := 200
	if v := os.Getenv("MADSAN_DEDUP_CLUSTER_LIMIT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			clusterLimit = n
		}
	}
	outPath := os.Getenv("MADSAN_DEDUP_OUTPUT")
	if outPath == "" {
		outPath = dedup.PairExportFilename()
	}

	f, err := os.Create(outPath)
	if err != nil {
		log.Fatal().Err(err).Str("path", outPath).Msg("create output")
	}
	defer f.Close()

	pairCount, err := dedup.ExportCompanyPairsCSV(ctx, pool, clusterLimit, f)
	if err != nil {
		log.Fatal().Err(err).Msg("export failed")
	}
	log.Info().
		Int("pair_count", pairCount).
		Int("cluster_limit", clusterLimit).
		Str("path", outPath).
		Msg("company pair CSV export complete (Splink prep)")
}
