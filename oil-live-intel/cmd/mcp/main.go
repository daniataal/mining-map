package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/mining-map/oil-live-intel/internal/db"
	"github.com/mining-map/oil-live-intel/internal/mcp"
	"github.com/mining-map/oil-live-intel/internal/utils"
)

func main() {
	cfg := config.Load()
	log := utils.NewLogger()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("database connect failed")
	}
	defer pool.Close()

	if err := db.RunMigrations(ctx, pool); err != nil {
		log.Fatal().Err(err).Msg("migrations failed")
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		cancel()
	}()

	log.Info().Msg("oil-live-intel MCP server (stdio)")
	if err := mcp.RunStdio(ctx, pool, cfg, log); err != nil && err != context.Canceled {
		log.Fatal().Err(err).Msg("mcp server failed")
	}
}
