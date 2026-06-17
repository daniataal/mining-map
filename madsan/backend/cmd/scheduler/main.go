package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/ingestion"
)

var schedules = []struct {
	jobType  string
	source   string
	interval time.Duration
}{
	{interval: 6 * time.Hour, jobType: "watch_folder", source: "raw_watch"},
	{interval: 7 * 24 * time.Hour, jobType: "bunker_seed", source: "bunker_fuel_suppliers"},
	{interval: 24 * time.Hour, jobType: "legacy_import", source: "legacy_mining_db"},
	{interval: 24 * time.Hour, jobType: "eia_daily", source: "eia_daily_spot"},
	{interval: 24 * time.Hour, jobType: "eia_company_imports", source: "eia_company_imports"},
	{interval: 24 * time.Hour, jobType: "world_bank_prices", source: "world_bank_pink_sheet"},
	{interval: 24 * time.Hour, jobType: "jodi_oil_import", source: "jodi_oil"},
	{interval: 24 * time.Hour, jobType: "jodi_market_pressure", source: "jodi_oil"},
	{interval: 7 * 24 * time.Hour, jobType: "gem_oil_foundation", source: "gem_goget_extraction"},
	{interval: 7 * 24 * time.Hour, jobType: "gem_infrastructure_foundation", source: "gem_infrastructure_foundation"},
	{interval: 7 * 24 * time.Hour, jobType: "gem_geometry_import", source: "gem_geojson"},
	{interval: 24 * time.Hour, jobType: "terminal_enrichment", source: "terminal_enrichment"},
	{interval: 6 * time.Hour, jobType: "cargo_estimates_backfill", source: "ais_draft_delta_v1"},
	{interval: 24 * time.Hour, jobType: "oil_opportunity_candidates", source: "oil_opportunity_v1"},
	{interval: 24 * time.Hour, jobType: "opportunity_chain_segments", source: "opportunity_chain_segments_v1"},
	{interval: 24 * time.Hour, jobType: "broker_alpha_snapshots", source: "broker_alpha_v1"},
	{interval: 6 * time.Hour, jobType: "sts_open_vessel_leads", source: "ais_open_sts_v1"},
	{interval: 12 * time.Hour, jobType: "cargo_voyage_linker", source: "cargo_voyage_linker_v1"},
	{interval: 24 * time.Hour, jobType: "landed_margin_snapshots", source: "landed_margin_v1"},
	{interval: 1 * time.Hour, jobType: "deal_watch_scan", source: "deal_watch"},
	{interval: 7 * 24 * time.Hour, jobType: "vessel_enrichment", source: "vessel_enrichment"},
	{interval: 6 * time.Hour, jobType: "port_call_sweep", source: "live_ais"},
	{interval: 1 * time.Hour, jobType: "sts_detect", source: "ais_proximity"},
	{interval: 45 * time.Minute, jobType: "sts_pair_predict", source: "commercial_sts_v1"},
	{interval: 24 * time.Hour, jobType: "sts_rescore", source: "sts_probability_backfill"},
	{interval: 7 * 24 * time.Hour, jobType: "gem_pipeline_import", source: "gem_goit_pipelines"},
	{interval: 24 * time.Hour, jobType: "mcr_rebuild", source: "syntheticbol"},
	{interval: 24 * time.Hour, jobType: "voyage_rebuild", source: "port_calls"},
	{interval: 7 * 24 * time.Hour, jobType: "gleif", source: "gleif"},
	{interval: 7 * 24 * time.Hour, jobType: "sec_edgar", source: "sec_edgar"},
	{interval: 24 * time.Hour, jobType: "legacy_procurement", source: "legacy_procurement"},
}

func main() {
	cfg := config.Load()
	ctx := context.Background()
	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()
	ing := ingestion.New(pool, cfg)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	lastRun := map[string]time.Time{}
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	log.Info().Msg("madsan scheduler started")
	for {
		select {
		case <-stop:
			return
		case now := <-ticker.C:
			for _, s := range schedules {
				key := s.jobType + ":" + s.source
				if t, ok := lastRun[key]; ok && now.Sub(t) < s.interval {
					continue
				}
				id, err := ing.EnqueueDeduped(ctx, s.jobType, s.source, map[string]any{"trigger": "scheduler"})
				if err != nil {
					if err == ingestion.ErrJobAlreadyQueued {
						lastRun[key] = now
						log.Debug().Str("job", key).Str("existing", id.String()).Msg("job already queued")
					} else {
						log.Error().Err(err).Str("job", key).Msg("enqueue failed")
					}
					continue
				}
				lastRun[key] = now
				log.Info().Str("job", key).Str("id", id.String()).Msg("job enqueued")
			}
		}
	}
}
