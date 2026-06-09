package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/auth"
	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/deals"
	"github.com/madsan/intelligence/internal/entitlements"
	"github.com/madsan/intelligence/internal/ingestion"
	"github.com/madsan/intelligence/internal/markets"
	"github.com/madsan/intelligence/internal/maritime"
	"github.com/madsan/intelligence/internal/realtime"
	"github.com/madsan/intelligence/internal/search"
	"github.com/madsan/intelligence/internal/tiles"
)

type Server struct {
	pool     *pgxpool.Pool
	log      zerolog.Logger
	cfg      config.Config
	auth     *auth.Service
	ent      *entitlements.Resolver
	hub      *realtime.Hub
	deals    *deals.Service
	search   *search.Service
	tiles    *tiles.Service
	ingest   *ingestion.Service
	aisStats *maritime.SyncStats
	parity   parityCache
}

func NewServer(pool *pgxpool.Pool, log zerolog.Logger, cfg config.Config) *Server {
	hub := realtime.NewHub(log)
	hub.SetPool(pool)
	go hub.Run()
	srv := &Server{
		pool:   pool,
		log:    log,
		cfg:    cfg,
		auth:   auth.New(pool, cfg),
		ent:    entitlements.New(pool),
		hub:    hub,
		deals:  deals.New(pool, cfg.OpenSanctionsAPIKey),
		search: search.New(pool),
		tiles:  tiles.New(pool),
		ingest: ingestion.New(pool, cfg),
	}
	srv.startAISSync()
	return srv
}

func (s *Server) startAISSync() {
	legacyConfigured := s.cfg.LegacyDBURL != ""
	s.aisStats = maritime.NewSyncStats(s.cfg.EnableAISSync, s.cfg.AISSyncInterval, legacyConfigured)
	if !s.cfg.EnableAISSync || !legacyConfigured {
		return
	}
	ctx := context.Background()
	legacy, err := database.ConnectURL(ctx, s.cfg.LegacyDBURL)
	if err != nil {
		s.log.Warn().Err(err).Msg("ais sync: legacy db unavailable")
		s.aisStats.RecordError(err)
		return
	}
	syncer := maritime.NewSyncer(s.pool, legacy, s.log)
	syncer.SetStats(s.aisStats)
	syncer.OnDelta(func(d maritime.VesselDelta) {
		s.hub.PublishVesselDelta(d)
	})
	go func() {
		defer legacy.Close()
		syncer.Run(context.Background(), s.cfg.AISSyncInterval)
	}()
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer, middleware.Timeout(60*time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001", "http://localhost:9080", "http://127.0.0.1:9080"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
	}))

	r.Get("/health/live", s.healthLive)
	r.Get("/health", s.healthLive)

	r.Route("/api/core", func(api chi.Router) {
		api.Post("/auth/register", s.register)
		api.Post("/auth/login", s.login)
		api.Get("/auth/me", s.me)
		api.Get("/ws", s.hub.ServeWS)
		api.Get("/entities/{entityType}/{id}", s.getEntity)
	})

	r.Route("/api/energy", func(api chi.Router) {
		api.Get("/assets", s.listEnergyAssets)
		api.Get("/assets/{id}", s.getAsset)
		api.Get("/companies/{id}", s.getCompany)
		api.Get("/vessels/by-mmsi/{mmsi}", s.getVesselByMMSI)
		api.Get("/vessels/{id}", s.getVessel)
		api.Get("/suppliers/search", s.supplierSearch)
	})

	r.Route("/api/metals", func(api chi.Router) {
		api.Get("/assets", s.listMetalsAssets)
		api.Get("/licenses/summary", s.metalsLicenseSummary)
	})

	r.Route("/api/deals", func(api chi.Router) {
		api.Post("/verify", s.verifyDeal)
		api.Get("/{id}", s.getDeal)
		api.Get("/{id}/pack", s.dealPack)
		api.Post("/{id}/watch", s.watchDeal)
	})

	r.Route("/api/portal", func(api chi.Router) {
		api.Post("/offers", s.submitSupplierOffer)
		api.Post("/feedback", s.submitFeedback)
	})

	r.Route("/api/admin", func(api chi.Router) {
		api.Use(s.requireAuth)
		api.Get("/ingestion/jobs", s.listIngestionJobs)
		api.Post("/ingestion/enqueue", s.enqueueIngestionJob)
		api.Get("/sources", s.listSources)
		api.Get("/review-queue", s.listReviewQueue)
		api.Post("/review-queue/{id}/resolve", s.resolveReviewQueueItem)
		api.Get("/insights/summary", s.adminInsightsV2)
		api.Get("/health", s.adminHealthPlatform)
		api.Get("/health/runtime", s.adminHealthRuntime)
		api.Get("/dedup/companies", s.listCompanyDuplicates)
		api.Get("/dedup/companies/pairs.csv", s.exportCompanyPairsCSV)
		api.Post("/dedup/companies/scan", s.scanCompanyDuplicates)
	})

	r.Get("/tiles/{layer}/{z}/{x}/{y}.mvt", s.tiles.ServeMVT)
	r.Get("/api/core/search", s.search.Handle)
	r.Get("/api/core/ticker", markets.NewHandler(s.cfg.EIAAPIKey).ServeHTTP)
	r.Get("/api/billing/plans", s.listPlans)

	return r
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := s.auth.ParseRequest(r); err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) healthLive(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"status": "ok"})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
