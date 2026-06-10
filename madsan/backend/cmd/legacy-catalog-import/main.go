package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/ingestion"
)

func main() {
	tablesFlag := flag.String("tables", "", "comma-separated legacy catalog tables (default: all)")
	maxRows := flag.Int("max-rows", 0, "max rows per table (0 = unlimited)")
	dryRun := flag.Bool("dry-run", false, "count only, no writes")
	flag.Parse()

	cfg := config.Load()
	ctx := context.Background()
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
	payload := map[string]any{"tables": tables, "max_rows": *maxRows, "dry_run": *dryRun}
	raw, _ := json.Marshal(payload)

	ing := ingestion.New(pool, cfg)
	var id uuid.UUID
	err = pool.QueryRow(ctx, `
		INSERT INTO ingestion_jobs (job_type, source_slug, status, payload, scheduled_at, started_at)
		VALUES ('legacy_import', 'legacy_mining_db', 'running', $1::jsonb, now(), now()) RETURNING id
	`, raw).Scan(&id)
	if err != nil {
		fatal("enqueue", err)
	}
	if err := ing.ProcessJob(ctx, id, *dryRun); err != nil {
		fatal("import", err)
	}
	var report []byte
	_ = pool.QueryRow(ctx, `SELECT result_report FROM ingestion_jobs WHERE id = $1`, id).Scan(&report)
	fmt.Printf("job %s\n%s\n", id, string(report))
}

func fatal(step string, err error) {
	fmt.Fprintf(os.Stderr, "legacy-catalog-import %s: %v\n", step, err)
	os.Exit(1)
}
