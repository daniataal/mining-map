package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/madsan/intelligence/internal/api"
	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
)

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	cfg := config.Load()

	ctx := context.Background()
	if os.Getenv("MADSAN_RUN_MIGRATIONS") != "false" {
		if err := database.RunMigrations(cfg.DatabaseURL); err != nil {
			log.Fatal().Err(err).Msg("migrations failed")
		}
	}

	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect failed")
	}
	defer pool.Close()
	if err := database.Ping(ctx, pool); err != nil {
		log.Fatal().Err(err).Msg("db ping failed")
	}

	srv := api.NewServer(pool, log.Logger, cfg)
	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Info().Str("addr", cfg.Addr).Msg("madsan api listening")
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}
