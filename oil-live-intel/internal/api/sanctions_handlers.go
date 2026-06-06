package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/mining-map/oil-live-intel/internal/services/sanctions"
)

func (s *Server) sanctionsStore() *sanctions.Store {
	if s.sanctionsCache == nil {
		ttl := time.Duration(s.Config.OpenSanctionsCountryCacheTTL) * time.Second
		s.sanctionsCache = sanctions.NewStore(
			s.Pool,
			ttl,
			strings.TrimSpace(s.Config.OpenSanctionsAPIKey) != "",
		)
	}
	return s.sanctionsCache
}

// SanctionsCountrySummary GET /api/oil-live/sanctions/country-summary
func (s *Server) SanctionsCountrySummary(w http.ResponseWriter, r *http.Request) {
	if s.Pool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database_unavailable"})
		return
	}

	country := strings.TrimSpace(r.URL.Query().Get("country"))
	resp, err := s.sanctionsStore().Summary(r.Context(), country)
	if err != nil {
		if err.Error() == "database_unavailable" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if resp.Countries == nil {
		resp.Countries = []sanctions.CountrySummary{}
	}
	writeJSONCached(w, http.StatusOK, resp, s.Config.OpenSanctionsCountryCacheTTL)
}
