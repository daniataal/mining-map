package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/ingestion"
)

func main() {
	tablesFlag := flag.String("tables", "", "comma-separated tables (legacy: oil_intelligence_cards,entity_relationships; gem: gem_extraction,gem_plants,gem_pipelines)")
	repoRoot := flag.String("repo-root", "", "repo root containing GEM xlsx files (default: auto-detect)")
	maxRows := flag.Int("max-rows", 0, "max rows per table (0 = unlimited)")
	dryRun := flag.Bool("dry-run", false, "count only, no writes")
	gemSegments := flag.Bool("gem-segments", true, "also import legacy gem_pipeline_segments geometry into pipeline_graph_edges")
	parity := flag.Bool("parity", false, "print parity counts after import")
	migrate := flag.Bool("migrate", false, "run pending DB migrations before import")
	flag.Parse()

	cfg := config.Load()
	ctx := context.Background()

	if *migrate {
		if err := database.RunMigrations(cfg.DatabaseURL); err != nil {
			fatal("migrate", err)
		}
	}

	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		fatal("madsan db", err)
	}
	defer pool.Close()

	if cfg.LegacyDBURL == "" {
		fatal("legacy db", fmt.Errorf("LEGACY_DATABASE_URL not configured"))
	}

	var tables []string
	if *tablesFlag != "" {
		for _, t := range strings.Split(*tablesFlag, ",") {
			if s := strings.TrimSpace(t); s != "" {
				tables = append(tables, s)
			}
		}
	}

	ing := ingestion.New(pool, cfg)
	counts, err := ing.RunTier2LegacyImport(ctx, tables, *repoRoot, *maxRows, *dryRun, *gemSegments)
	out, _ := json.MarshalIndent(map[string]any{
		"tables":       tables,
		"counts":       counts,
		"dry_run":      *dryRun,
		"gem_segments": *gemSegments,
	}, "", "  ")
	fmt.Println(string(out))
	if err != nil {
		fatal("import", err)
	}

	if *parity && !*dryRun {
		legacy, err := database.ConnectURL(ctx, cfg.LegacyDBURL)
		if err != nil {
			fatal("legacy db", err)
		}
		defer legacy.Close()
		report, err := ingestion.RunLegacyParity(ctx, legacy, pool, 5.0)
		if err != nil {
			fatal("parity", err)
		}
		pout, _ := ingestion.ParityReportJSON(report)
		fmt.Println(string(pout))
		if !report.Passed {
			os.Exit(1)
		}
	}
}

func fatal(step string, err error) {
	fmt.Fprintf(os.Stderr, "legacy-tier2 %s: %v\n", step, err)
	os.Exit(1)
}
