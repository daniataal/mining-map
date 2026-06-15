package main

import (
	"context"
	"fmt"
	"os"
	"strconv"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/ingestion"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()

	threshold := 5.0
	if v := os.Getenv("MADSAN_PARITY_THRESHOLD_PCT"); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil && n > 0 {
			threshold = n
		}
	}

	madsan, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		fatal("madsan db connect", err)
	}
	defer madsan.Close()

	if cfg.LegacyDBURL == "" {
		fatal("legacy db", fmt.Errorf("LEGACY_DATABASE_URL not configured"))
	}
	legacy, err := database.ConnectURL(ctx, cfg.LegacyDBURL)
	if err != nil {
		fatal("legacy db connect", err)
	}
	defer legacy.Close()

	report, err := ingestion.RunLegacyParity(ctx, legacy, madsan, threshold)
	if err != nil {
		fatal("parity check", err)
	}

	out, err := ingestion.ParityReportJSON(report)
	if err != nil {
		fatal("marshal report", err)
	}
	fmt.Println(string(out))
	if !report.Passed {
		os.Exit(1)
	}
}

func fatal(step string, err error) {
	fmt.Fprintf(os.Stderr, "legacy-parity %s: %v\n", step, err)
	os.Exit(1)
}
