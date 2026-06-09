package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/mining-map/oil-live-intel/internal/services/mapserving"
)

// ListSupplierHubs serves hub-first bunker registry aggregates from map_serving_supplier_hubs.
func (s *Server) ListSupplierHubs(w http.ResponseWriter, r *http.Request) {
	rows, err := mapserving.ListSupplierHubs(r.Context(), s.Pool)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hubs": rows})
}

// RebuildMapServing rebuilds map serving read models (admin/internal).
func (s *Server) RebuildMapServing(w http.ResponseWriter, r *http.Request) {
	hubs, err := mapserving.RebuildSupplierHubs(r.Context(), s.Pool)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	popups, err := mapserving.RebuildPopupPayloads(r.Context(), s.Pool)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"supplier_hubs_rebuilt":  hubs,
		"popup_payloads_rebuilt": popups,
	})
}

// GetMapFeaturePopup serves a pre-materialized popup payload for a map feature.
func (s *Server) GetMapFeaturePopup(w http.ResponseWriter, r *http.Request) {
	featureKey := strings.TrimSpace(chi.URLParam(r, "feature_key"))
	if featureKey == "" {
		writeErr(w, http.StatusBadRequest, "feature_key required")
		return
	}
	row, err := mapserving.GetPopupPayload(r.Context(), s.Pool, featureKey)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if row == nil {
		writeErr(w, http.StatusNotFound, "popup not found")
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// GetMapFeaturePopupAt resolves a materialized popup near a map click.
func (s *Server) GetMapFeaturePopupAt(w http.ResponseWriter, r *http.Request) {
	lat, err := strconv.ParseFloat(strings.TrimSpace(r.URL.Query().Get("lat")), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "lat required")
		return
	}
	lng, err := strconv.ParseFloat(strings.TrimSpace(r.URL.Query().Get("lng")), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "lng required")
		return
	}
	layerID := strings.TrimSpace(r.URL.Query().Get("layer_id"))
	if layerID == "" {
		writeErr(w, http.StatusBadRequest, "layer_id required")
		return
	}
	maxM := float64(mapserving.FusionGemPipelineM)
	if layerID == "refineries" || layerID == "storage_terminals" {
		maxM = float64(mapserving.FusionTerminalMaxM)
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("max_distance_m")); raw != "" {
		if parsed, perr := strconv.ParseFloat(raw, 64); perr == nil && parsed > 0 {
			maxM = parsed
		}
	}

	featureKey := strings.TrimSpace(r.URL.Query().Get("feature_key"))
	var row *mapserving.PopupPayload
	if featureKey != "" {
		row, err = mapserving.GetPopupPayload(r.Context(), s.Pool, featureKey)
	} else {
		row, err = mapserving.LookupPopupAtPoint(r.Context(), s.Pool, lat, lng, layerID, maxM)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if row == nil {
		writeErr(w, http.StatusNotFound, "popup not found")
		return
	}
	writeJSON(w, http.StatusOK, row)
}
