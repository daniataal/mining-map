package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/mining-map/oil-live-intel/internal/db"
	"github.com/mining-map/oil-live-intel/internal/utils"
	"github.com/mining-map/oil-live-intel/internal/workers"
)

func main() {
	cfg := config.Load()
	log := utils.NewLogger()
	ctx := context.Background()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("database connect failed")
	}
	defer pool.Close()

	if err := db.RunMigrations(ctx, pool); err != nil {
		log.Fatal().Err(err).Msg("migrations failed")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go workers.RunPortCallMaintainer(ctx, pool, log)
	go workers.RunPositionCleanup(ctx, pool, cfg.AISPositionRetainHours, log)
	go workers.RunTradeSync(ctx, pool, cfg, log)
	go workers.RunOpportunityScanner(ctx, pool, log)
	if cfg.EnableAIS {
		go workers.RunAISIngestor(ctx, pool, cfg, log)
	}

	log.Info().
		Bool("ais", cfg.EnableAIS).
		Bool("eia", cfg.EnableEIA).
		Bool("comtrade", cfg.EnableComtrade).
		Msg("oil-live-intel worker started")

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	cancel()

	_, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	log.Info().Msg("worker shutdown")
}
