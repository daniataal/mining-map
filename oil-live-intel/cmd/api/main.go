package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mining-map/oil-live-intel/internal/api"
	"github.com/mining-map/oil-live-intel/internal/cache"
	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/mining-map/oil-live-intel/internal/db"
	"github.com/mining-map/oil-live-intel/internal/seed"
	"github.com/mining-map/oil-live-intel/internal/services/search"
	"github.com/mining-map/oil-live-intel/internal/services/shipvault"
	"github.com/mining-map/oil-live-intel/internal/utils"
	"github.com/rs/zerolog"
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

	srv := &api.Server{
		Pool:         pool,
		Log:          log,
		Config:       cfg,
		Hub:          api.NewHub(),
		SearchClient: searchClient,
	}

	responseCache := cache.New(cfg.RedisURL, log)
	defer responseCache.Close()

	router := api.NewRouter(srv, responseCache)

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

	// Seed and ShipVault can block on DB/network; run after the listener so health probes pass.
	go runDeferredStartup(ctx, srv, pool, cfg, log)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
	log.Info().Msg("shutdown complete")
}

func runDeferredStartup(ctx context.Context, srv *api.Server, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	if cfg.SeedOnStartup {
		if err := seed.RunIfEmpty(ctx, pool); err != nil {
			log.Warn().Err(err).Msg("seed failed")
		}
	}
	if err := seed.EnsureHormuzCrisisDemoMCR(ctx, pool); err != nil {
		log.Warn().Err(err).Msg("hormuz crisis demo MCR seed failed")
	}

	dbRefresh, dbErr := shipvault.LoadRefreshToken(ctx, pool)
	if dbErr != nil {
		log.Warn().Err(dbErr).Msg("ShipVault credential load failed")
	}
	envBootstrap := strings.TrimSpace(cfg.ShipVaultRefreshToken) != "" ||
		strings.TrimSpace(cfg.ShipVaultSessionJSON) != ""
	switch {
	case cfg.ShipVaultConfigured(dbRefresh != ""):
		if _, err := srv.InitShipVault(ctx); err != nil {
			log.Warn().Err(err).Msg("ShipVault init failed; enrichment disabled")
		} else if dbRefresh != "" && !envBootstrap {
			log.Info().Msg("ShipVault: persistent auth from DB")
		} else if envBootstrap {
			log.Info().Msg("ShipVault: bootstrapped from env — refresh token persisted to DB; remove SHIPVAULT_REFRESH_TOKEN/SESSION_JSON from .env when ready")
		}
	case cfg.ShipVaultBootstrapAllowed:
		log.Info().Msg("ShipVault: bootstrap needed — POST /api/oil-live/admin/shipvault/bootstrap once with refreshToken")
	default:
		log.Info().Msg("ShipVault: bootstrap needed — set SHIPVAULT_REFRESH_TOKEN or persist via admin bootstrap")
	}
}
