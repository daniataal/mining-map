package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func NewRouter(s *Server) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	r.Route("/api/oil-live", func(api chi.Router) {
		api.Get("/health", s.Health)
		api.Get("/sync-status", s.SyncStatus)
		api.Get("/map", s.Map)
		api.Get("/terminals", s.ListTerminals)
		api.Get("/terminals/{id}/logistics-hints", s.LogisticsHints)
		api.Get("/terminals/{id}", s.GetTerminal)
		api.Post("/terminals/import-geojson", s.ImportGeoJSON)
		api.Get("/vessels/live", s.LiveVessels)
		api.Get("/vessels/{mmsi}", s.GetVessel)
		api.Get("/port-calls/recent", s.RecentPortCalls)
		api.Get("/port-calls/{id}", s.GetPortCall)
		api.Get("/port-calls/{id}/explain", s.ExplainPortCall)
		api.Get("/port-calls/{id}/confidence-breakdown", s.ConfidenceBreakdown)
		api.Get("/watchlists", s.ListWatchlists)
		api.Post("/watchlists", s.AddWatchlist)
		api.Delete("/watchlists/{id}", s.DeleteWatchlist)
		api.Get("/alerts", s.ListAlerts)
		api.Post("/alerts/{id}/read", s.MarkAlertRead)
		api.Post("/alerts/mark-all-read", s.MarkAllAlertsRead)
		api.Post("/alerts/{id}/assign", s.AssignAlert)
		api.Get("/trade/flows", s.ListTradeFlows)
		api.Get("/trade-flows", s.ListMcrTradeFlows)
		api.Get("/opportunities", s.ListOpportunities)
		api.Get("/opportunities/{id}/deal-pack", s.OpportunityDealPack)
		api.Get("/opportunities/{id}/economics", s.OpportunityEconomics)
		api.Put("/opportunities/{id}/economics", s.OpportunityEconomics)
		api.Get("/cargo-records", s.ListCargoRecords)
		api.Get("/cargo-records/map", s.ListCargoRecordsMap)
		api.Get("/cargo-records/{id}", s.GetCargoRecord)
		api.Get("/commercial-events", s.ListCommercialEvents)
		api.Get("/intelligence", s.ListIntelligence)
		api.Get("/intelligence/{id}", s.GetIntelligence)
		api.Get("/companies", s.ListCompanies)
		api.Get("/companies/{id}", s.GetCompany)
		api.Get("/companies/{id}/shipments", s.GetCompanyShipments)
		api.Get("/companies/{id}/contacts", s.CompanyContacts)
		api.Post("/companies/{id}/contacts", s.AddCompanyContact)
		api.Get("/companies/{id}/counterparty-hints", s.CounterpartyHints)
		api.Post("/companies/{id}/draft-outreach", s.DraftOutreach)
		api.Post("/companies/{id}/save-to-suppliers", s.SaveToSuppliers)
		api.Get("/suppliers/candidates", s.SupplierCandidates)
		api.Get("/search", s.Search)
		api.Get("/search/health", s.SearchHealthHandler)
		api.Get("/ws", s.WebSocket)
		api.Post("/internal/broadcast", s.InternalBroadcast)
		api.Post("/internal/trade-sync", s.TriggerTradeSync)
		api.Post("/internal/synthetic-bol-rebuild", s.TriggerSyntheticBolRebuild)
	})
	return r
}
