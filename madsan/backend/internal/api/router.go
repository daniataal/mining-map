package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/audit"
	"github.com/madsan/intelligence/internal/auth"
	"github.com/madsan/intelligence/internal/compliance"
	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/deals"
	"github.com/madsan/intelligence/internal/documents"
	"github.com/madsan/intelligence/internal/entitlements"
	"github.com/madsan/intelligence/internal/ingestion"
	"github.com/madsan/intelligence/internal/llm"
	"github.com/madsan/intelligence/internal/maritime"
	"github.com/madsan/intelligence/internal/markets"
	"github.com/madsan/intelligence/internal/notify"
	"github.com/madsan/intelligence/internal/realtime"
	"github.com/madsan/intelligence/internal/search"
	"github.com/madsan/intelligence/internal/tiles"
)

type Server struct {
	pool       *pgxpool.Pool
	legacyPool *pgxpool.Pool
	log        zerolog.Logger
	cfg        config.Config
	auth       *auth.Service
	ent        *entitlements.Resolver
	hub        *realtime.Hub
	deals      *deals.Service
	documents  *documents.Service
	llm        *llm.Client
	search     *search.Service
	tiles      *tiles.Service
	ingest     *ingestion.Service
	aisStats   *maritime.SyncStats
	ledger     *compliance.SourceLedger
	auditor    *audit.Writer
	notifier   notify.Sender
	parity     parityCache
}

func NewServer(pool *pgxpool.Pool, log zerolog.Logger, cfg config.Config) *Server {
	hub := realtime.NewHub(log)
	hub.SetPool(pool)
	go hub.Run()
	var legacyPool *pgxpool.Pool
	if cfg.LegacyDBURL != "" {
		if legacy, err := database.ConnectURL(context.Background(), cfg.LegacyDBURL); err != nil {
			log.Warn().Err(err).Msg("legacy db unavailable for pipeline tiles")
		} else {
			legacyPool = legacy
		}
	}
	srv := &Server{
		pool:       pool,
		legacyPool: legacyPool,
		log:        log,
		cfg:        cfg,
		auth:       auth.New(pool, cfg),
		ent:        entitlements.New(pool, cfg.GrantMapPremiumLayers),
		hub:        hub,
		deals:      deals.New(pool, cfg.OpenSanctionsAPIKey, cfg.EIAAPIKey),
		documents:  documents.New(pool, cfg.DocumentsDir),
		llm:        llm.NewFromEnv(),
		search:     search.New(pool),
		tiles:      tiles.New(pool, legacyPool),
		ingest:     ingestion.New(pool, cfg),
		ledger:     compliance.NewSourceLedger(pool),
		auditor:    audit.NewWriter(pool),
		notifier:   notify.NewLogSender(log),
	}
	srv.deals.SetNotifier(srv.notifier)
	srv.startAISSync()
	return srv
}

func (s *Server) startAISSync() {
	legacyConfigured := s.cfg.LegacyDBURL != ""
	directMode := s.cfg.EnableAISDirect && s.cfg.AISStreamAPIKey != ""
	useLegacy := s.cfg.UseLegacyAISSync()

	s.aisStats = maritime.NewSyncStats(useLegacy, s.cfg.AISSyncInterval, legacyConfigured)
	if directMode {
		s.aisStats.SetMode("direct")
		s.log.Info().Msg("ais: direct ingest mode — legacy 2-hop sync disabled; run cmd/ais-ingest")
		s.startAISDeltaListener(context.Background())
		return
	}
	if !useLegacy {
		if !legacyConfigured {
			s.log.Info().Msg("ais sync disabled: no legacy database and no direct ingest key")
		}
		return
	}
	ctx := context.Background()
	legacy, err := database.ConnectURL(ctx, s.cfg.LegacyDBURL)
	if err != nil {
		s.log.Warn().Err(err).Msg("ais sync: legacy db unavailable")
		s.aisStats.RecordError(err)
		return
	}
	lookback := time.Duration(s.cfg.AISSyncLookbackHours) * time.Hour
	syncer := maritime.NewSyncer(s.pool, legacy, s.log, lookback)
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
		AllowedOrigins:   allowedCORSOrigins(),
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Madsan-Source-Keys"},
		AllowCredentials: true,
	}))

	r.Get("/health/live", s.healthLive)
	r.Get("/health", s.healthLive)

	r.Route("/api/core", func(api chi.Router) {
		api.With(s.withAudit("auth.register", "user")).Post("/auth/register", s.register)
		api.With(s.withAudit("auth.login", "session")).Post("/auth/login", s.login)
		api.With(s.withAudit("auth.logout", "session")).Post("/auth/logout", s.logout)
		api.Get("/auth/me", s.me)
		api.Get("/ws", s.hub.ServeWS)
		api.Get("/entities/{entityType}/{id}", s.getEntity)
		api.With(s.requireAuth).Post("/entities/{entityType}/{id}/enrichment/refresh", s.refreshEntityEnrichment)
		api.Get("/aggregates/{entityType}/{entityID}", s.getHistoricAggregates)
		api.Get("/assets/lookup", s.getAssetByLegacy)
		api.Get("/trust/{entityType}/{id}", s.getTrustScore)
	})

	r.Route("/api/energy", func(api chi.Router) {
		api.Get("/assets", s.listEnergyAssets)
		api.Get("/assets/{id}", s.getAsset)
		api.Get("/companies/{id}", s.getCompany)
		api.Get("/sts/events", s.listSTSEvents)
		api.Get("/sts/summary", s.getSTSSummary)
		api.Get("/sts/predictions", s.listSTSPredictions)
		api.Get("/storage/sites", s.listStorageSites)
		api.Get("/storage/summary", s.getStorageSummary)
		api.Get("/bunker/suppliers", s.listBunkerSuppliers)
		api.Get("/vessels/by-mmsi/{mmsi}", s.getVesselByMMSI)
		api.Get("/vessels/by-mmsi/{mmsi}/track", s.getVesselTrack)
		api.Get("/vessels/by-mmsi/{mmsi}/port-calls", s.getVesselPortCalls)
		api.Get("/vessels/{id}", s.getVessel)
		api.Get("/shipvault/companies/{id}", s.getShipvaultCompany)
		api.Get("/mcr/corridors", s.listMCRCorridors)
		api.With(s.requireAuth, s.withTenantGUC, s.requireEntitlement(featureSupplierDiscovery)).Get("/suppliers/search", s.supplierSearch)
		api.Get("/pipelines/nearest-gem", s.nearestGemPipeline)
		api.Get("/pipelines/{id}/connectivity", s.getPipelineConnectivity)
		api.Get("/mcr/scaffold/status", s.mcrScaffoldStatus)
		api.Get("/predictive/status", s.predictiveStatus)
		api.Get("/leads/unknown-suppliers", s.unknownSupplierLeads)
	})

	r.Route("/api/intel", func(api chi.Router) {
		api.Get("/opportunities", s.listIntelOpportunities)
		api.Get("/opportunities/{id}/dossier", s.getIntelOpportunityDossier)
		api.Get("/sts-open-vessels", s.listIntelSTSOpenVessels)
		api.Get("/cargo-movements", s.listIntelCargoMovements)
		api.Get("/asset-geometries", s.listIntelAssetGeometries)
		api.Get("/arbitrage", s.compareIntelArbitrage)
		api.Get("/importers", s.listIntelImporters)
		api.Get("/market-pressure", s.listIntelMarketPressure)
		api.Get("/sts-predictions", s.listIntelSTSPredictions)
		api.Get("/entities/{type}/{id}/commercial-profile", s.getCommercialProfile)
		api.Get("/lanes/{id}", s.getIntelLane)
		api.Get("/investor-paths", s.listIntelInvestorPaths)
		api.Get("/investors/{id}/exposure", s.getInvestorExposure)
	})

	r.Route("/api/metals", func(api chi.Router) {
		api.Get("/assets", s.listMetalsAssets)
		api.Get("/licenses/summary", s.metalsLicenseSummary)
	})

	r.Route("/api/deals", func(api chi.Router) {
		api.Get("/", s.listPlaygroundDeals)
		api.Get("/map", s.dealPlaygroundMap)
		api.With(s.requireAuth, s.withAudit("deal.create", "deal")).Post("/", s.createPlaygroundDeal)
		api.Get("/{id}/graph", s.getDealGraph)
		api.With(s.requireAuth, s.withAudit("deal.update", "deal")).Patch("/{id}", s.updatePlaygroundDeal)
		api.With(s.requireAuth, s.withAudit("deal.delete", "deal")).Delete("/{id}", s.deletePlaygroundDeal)
		api.With(s.requireAuth).Post("/{id}/nodes", s.addDealNode)
		api.With(s.requireAuth).Patch("/{id}/nodes/{nodeID}", s.updateDealNode)
		api.With(s.requireAuth).Delete("/{id}/nodes/{nodeID}", s.deleteDealNode)
		api.With(s.requireAuth).Post("/{id}/links", s.addDealLink)
		api.With(s.requireAuth).Delete("/{id}/links/{linkID}", s.deleteDealLink)
		api.Get("/{id}", s.getDeal)
		api.With(s.requireAuth, s.withTenantGUC, s.requireEntitlement(featureDealVerification), s.requireCommercialSources).Post("/verify", s.verifyDeal)
		api.With(s.requireAuth, s.withTenantGUC, s.requireEntitlement(featureDealPackExport), s.requireCommercialSources).Get("/{id}/pack", s.dealPack)
		api.With(s.requireAuth, s.withTenantGUC, s.requireEntitlement(featureDealVerification)).Post("/{id}/dd-assist", s.dealDDAssist)
		api.With(s.requireAuth, s.withTenantGUC, s.requireEntitlement(featureDealWatch)).Post("/{id}/watch", s.watchDeal)
		api.With(s.requireAuth, s.withTenantGUC, s.requireEntitlement(featureDealWatch)).Delete("/{id}/watch", s.unwatchDeal)
		api.With(s.requireAuth, s.withTenantGUC, s.requireEntitlement(featureDealWatch)).Get("/{id}/changes", s.dealChanges)
	})

	r.With(s.requireAuth, s.withTenantGUC, s.requireEntitlement(featureDealVerification)).Post("/api/documents", s.uploadDocument)

	r.Post("/api/feedback", s.submitProductFeedback)

	r.Route("/api/legal", func(api chi.Router) {
		api.Post("/dispute", s.submitLegalDispute)
		api.Post("/privacy/erasure", s.submitGDPRErasure)
	})

	r.Route("/api/portal", func(api chi.Router) {
		api.Use(s.requireAuth, s.withTenantGUC, s.requireMeteredEntitlement(featureSupplierPortal))
		api.Post("/offers", s.submitSupplierOffer)
		api.Post("/feedback", s.submitFeedback)
	})

	r.Route("/api/admin", func(api chi.Router) {
		api.Use(s.requireAuth, s.withTenantGUC, s.requireMeteredEntitlement(featureAPIAccess))
		api.Get("/ingestion/jobs", s.listIngestionJobs)
		api.With(s.withAudit("admin.ingestion.enqueue", "ingestion_job")).Post("/ingestion/enqueue", s.enqueueIngestionJob)
		api.Get("/sources", s.listSources)
		api.Get("/review-queue", s.listReviewQueue)
		api.With(s.withAudit("admin.review.resolve", "manual_review_queue")).Post("/review-queue/{id}/resolve", s.resolveReviewQueueItem)
		api.Get("/insights/summary", s.adminInsightsV2)
		api.Get("/health", s.adminHealthPlatform)
		api.Get("/health/runtime", s.adminHealthRuntime)
		api.Get("/health/observability", s.adminHealthObservability)
		api.Get("/dedup/companies", s.listCompanyDuplicates)
		api.Get("/dedup/companies/pairs.csv", s.exportCompanyPairsCSV)
		api.With(s.withAudit("admin.dedup.scan", "dedup")).Post("/dedup/companies/scan", s.scanCompanyDuplicates)
		api.With(s.withAudit("admin.dedup.enqueue_review", "dedup_cluster")).Post("/dedup/clusters/{id}/enqueue-review", s.enqueueClusterMergeReview)
		api.With(s.requireAdminRole).Get("/users", s.adminListUsers)
		api.With(s.requireAdminRole, s.withAudit("admin.user.create", "user")).Post("/users", s.adminCreateUser)
		api.With(s.requireAdminRole, s.withAudit("admin.user.update", "user")).Patch("/users/{id}", s.adminUpdateUser)
		api.With(s.requireAdminRole, s.withAudit("admin.user.reset_password", "user")).Post("/users/{id}/reset-password", s.adminResetPassword)
		api.With(s.requireAdminRole, s.withAudit("admin.user.revoke_sessions", "user")).Post("/users/{id}/revoke-sessions", s.adminRevokeSessions)
	})

	r.With(s.requirePremiumTileAccess).Get("/tiles/{layer}/{z}/{x}/{y}.mvt", s.tiles.ServeMVT)
	r.Get("/api/core/search", s.search.Handle)
	r.Get("/api/core/ticker", markets.NewHandler(s.cfg.EIAAPIKey).ServeHTTP)
	r.Get("/api/billing/plans", s.listPlans)

	return r
}

func allowedCORSOrigins() []string {
	origins := []string{
		"http://localhost:3000",
		"http://127.0.0.1:3000",
		"http://localhost:3001",
		"http://127.0.0.1:3001",
		"http://localhost:3010",
		"http://127.0.0.1:3010",
		"http://localhost:3011",
		"http://127.0.0.1:3011",
		"http://localhost:9080",
		"http://127.0.0.1:9080",
	}
	for _, raw := range strings.Split(os.Getenv("MADSAN_CORS_ORIGINS"), ",") {
		origin := strings.TrimSpace(raw)
		if origin == "" {
			continue
		}
		origins = append(origins, origin)
	}
	return origins
}

func (s *Server) healthLive(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"status": "ok"})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
