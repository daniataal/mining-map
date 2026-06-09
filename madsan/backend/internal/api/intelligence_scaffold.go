package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/madsan/intelligence/internal/leads"
	"github.com/madsan/intelligence/internal/mcr"
	"github.com/madsan/intelligence/internal/predictive"
)

func (s *Server) mcrScaffoldStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, mcr.ScaffoldStatus())
}

func (s *Server) predictiveStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, predictive.ScaffoldStatus())
}

func (s *Server) unknownSupplierLeads(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
	params := leads.UnknownSupplierParams{
		CountryCode: strings.TrimSpace(r.URL.Query().Get("country_code")),
		Commodity:   strings.TrimSpace(r.URL.Query().Get("commodity")),
		Limit:       limit,
	}
	if params.CountryCode == "" {
		params.CountryCode = strings.TrimSpace(r.URL.Query().Get("country"))
	}
	results, err := leads.UnknownSupplierLeads(r.Context(), s.pool, params)
	if err != nil {
		http.Error(w, "query failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{
		"tier":    leads.TierInferred,
		"count":   len(results),
		"leads":   results,
		"message": "Trade-flow gap backtracking over assets missing operator_company_id; inferred tier — verify before outreach",
	})
}
