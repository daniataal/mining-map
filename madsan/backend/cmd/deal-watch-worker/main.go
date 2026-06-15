package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/rs/zerolog/log"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/deals"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()
	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()

	svc := deals.New(pool, cfg.OpenSanctionsAPIKey, cfg.EIAAPIKey)
	report, err := svc.ScanAllWatchSubscriptions(ctx)
	out, _ := json.MarshalIndent(map[string]any{
		"subscriptions_scanned": report.Subscriptions,
		"events_inserted":       report.EventsInserted,
		"skipped_no_snapshot":   report.Skipped,
		"errors":                report.Errors,
	}, "", "  ")
	fmt.Println(string(out))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if report.Errors > 0 {
		os.Exit(2)
	}
}
