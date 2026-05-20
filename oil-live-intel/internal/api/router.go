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
		api.Get("/map", s.Map)
		api.Get("/terminals", s.ListTerminals)
		api.Get("/terminals/{id}", s.GetTerminal)
		api.Post("/terminals/import-geojson", s.ImportGeoJSON)
		api.Get("/vessels/live", s.LiveVessels)
		api.Get("/vessels/{mmsi}", s.GetVessel)
		api.Get("/port-calls/recent", s.RecentPortCalls)
		api.Get("/port-calls/{id}", s.GetPortCall)
		api.Get("/intelligence", s.ListIntelligence)
		api.Get("/intelligence/{id}", s.GetIntelligence)
		api.Get("/companies", s.ListCompanies)
		api.Get("/companies/{id}", s.GetCompany)
		api.Post("/companies/{id}/save-to-suppliers", s.SaveToSuppliers)
		api.Get("/suppliers/candidates", s.SupplierCandidates)
		api.Get("/ws", s.WebSocket)
	})
	return r
}
