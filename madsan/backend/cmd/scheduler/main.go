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
	{interval: 1 * time.Hour, jobType: "deal_watch_scan", source: "deal_watch"},
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
