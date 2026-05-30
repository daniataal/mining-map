package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mining-map/oil-live-intel/internal/api"
	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/mining-map/oil-live-intel/internal/db"
	"github.com/mining-map/oil-live-intel/internal/seed"
	"github.com/mining-map/oil-live-intel/internal/services/search"
	"github.com/mining-map/oil-live-intel/internal/services/shipvault"
	"github.com/mining-map/oil-live-intel/internal/utils"
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
	if cfg.SeedOnStartup {
		if err := seed.RunIfEmpty(ctx, pool); err != nil {
			log.Warn().Err(err).Msg("seed failed")
		}
	}

	// Elasticsearch is optional — the search endpoint degrades to
	// {"error":"search_unavailable"} (HTTP 503) when the client cannot be
	// built (e.g. empty URL) or when the cluster is unreachable. We
	// instantiate the client lazily without blocking startup.
	var searchClient search.Client
	if cfg.ElasticsearchURL != "" {
		c, err := search.NewClient(cfg.ElasticsearchURL)
		if err != nil {
			log.Warn().Err(err).Str("url", cfg.ElasticsearchURL).Msg("search client init failed; /api/oil-live/search will return 503")
		} else {
			searchClient = c
		}
	}

	// ShipVault vessel enrichment is optional — initialised only when credentials
	// are present. The service performs an initial token fetch synchronously so
	// that any credential errors surface at startup rather than on first request.
	var shipVaultSvc *shipvault.Service
	if cfg.ShipVaultEnabled {
		shipVaultSvc = shipvault.NewService(
			cfg.ShipVaultBaseURL,
			cfg.ShipVaultBearerToken,
			cfg.ShipVaultCacheTTLDays,
			log,
		)
		log.Info().Msg("ShipVault vessel enrichment enabled")
	} else {
		log.Info().Msg("ShipVault vessel enrichment disabled (set SHIPVAULT_BEARER_TOKEN to enable)")
	}

	srv := &api.Server{
		Pool:         pool,
		Log:          log,
		Config:       cfg,
		Hub:          api.NewHub(),
		SearchClient: searchClient,
		ShipVaultSvc: shipVaultSvc,
	}
	router := api.NewRouter(srv)

	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Info().Str("addr", httpServer.Addr).Msg("oil-live-intel api listening")
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("server failed")
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
	log.Info().Msg("shutdown complete")
}
