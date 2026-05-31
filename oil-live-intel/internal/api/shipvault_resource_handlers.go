package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mining-map/oil-live-intel/internal/services/shipvault"
)

func (s *Server) requireShipVault(w http.ResponseWriter) bool {
	if s.ShipVaultSvc == nil {
		writeErr(w, http.StatusServiceUnavailable, "ShipVault enrichment not configured")
		return false
	}
	return true
}

// GetShipVaultCompany returns company profile + fleet.
// GET /api/oil-live/shipvault/companies/{id}
func (s *Server) GetShipVaultCompany(w http.ResponseWriter, r *http.Request) {
	if !s.requireShipVault(w) {
		return
	}
	companyID := strings.TrimSpace(chi.URLParam(r, "id"))
	ownerName := strings.TrimSpace(r.URL.Query().Get("name"))
	if companyID == "" || companyID == "_" {
		var err error
		companyID, err = s.ShipVaultSvc.ResolveCompanyID(r.Context(), "", ownerName)
		if err != nil {
			status, msg := shipvault.MapEnrichmentError(err)
			writeErr(w, status, msg)
			return
		}
	}
	detail, err := s.ShipVaultSvc.LoadCompanyDetail(r.Context(), companyID)
	if err != nil {
		status, msg := shipvault.MapEnrichmentError(err)
		writeErr(w, status, msg)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"company": detail})
}

// GetShipVaultCompanyFleet returns fleet rows only (paginated upstream).
// GET /api/oil-live/shipvault/companies/{id}/fleet
func (s *Server) GetShipVaultCompanyFleet(w http.ResponseWriter, r *http.Request) {
	if !s.requireShipVault(w) {
		return
	}
	companyID := strings.TrimSpace(chi.URLParam(r, "id"))
	if companyID == "" {
		writeErr(w, http.StatusBadRequest, "company id required")
		return
	}
	fleet, err := s.ShipVaultSvc.GetFleet(r.Context(), companyID)
	if err != nil {
		status, msg := shipvault.MapEnrichmentError(err)
		writeErr(w, status, msg)
		return
	}
	rows := make([]shipvault.FleetVessel, 0, len(fleet))
	for _, f := range fleet {
		if f == nil {
			continue
		}
		rows = append(rows, shipvault.ParseFleetVessel(f))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"shipvault_company_id": companyID,
		"fleet":                rows,
		"count":                len(rows),
	})
}

// GetShipVaultYard returns yard profile + vessels built when available.
// GET /api/oil-live/shipvault/yards/{id}?name=
func (s *Server) GetShipVaultYard(w http.ResponseWriter, r *http.Request) {
	if !s.requireShipVault(w) {
		return
	}
	yardID := strings.TrimSpace(chi.URLParam(r, "id"))
	yardName := strings.TrimSpace(r.URL.Query().Get("name"))
	detail, err := s.ShipVaultSvc.LoadYardDetail(r.Context(), yardID, yardName)
	if err != nil {
		status, msg := shipvault.MapEnrichmentError(err)
		writeErr(w, status, msg)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"yard": detail})
}

// GetVesselShipVaultDetail returns extended ShipVault vessel detail beyond dossier summary.
// GET /api/oil-live/vessels/{mmsi}/shipvault/detail?imo=&vessel_id=
func (s *Server) GetVesselShipVaultDetail(w http.ResponseWriter, r *http.Request) {
	if !s.requireShipVault(w) {
		return
	}
	mmsi, err := strconv.ParseInt(chi.URLParam(r, "mmsi"), 10, 64)
	if err != nil || mmsi <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid mmsi")
		return
	}
	ctx := r.Context()
	imo := strings.TrimSpace(r.URL.Query().Get("imo"))
	if imo == "" {
		if meta, _ := s.lookupVesselRegistry(ctx, mmsi); meta != nil {
			imo = extractIMOFromMeta(meta)
		}
	}
	vesselID := strings.TrimSpace(r.URL.Query().Get("vessel_id"))
	detail, err := s.ShipVaultSvc.LoadVesselDetail(ctx, imo, vesselID)
	if err != nil {
		status, msg := shipvault.MapEnrichmentError(err)
		writeErr(w, status, msg)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"mmsi":    mmsi,
		"imo":     imo,
		"detail":  detail,
	})
}
