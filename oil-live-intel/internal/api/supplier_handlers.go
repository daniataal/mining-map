package api

import (
	"net/http"
	"strconv"

	"github.com/mining-map/oil-live-intel/internal/services/graphsync"
	"github.com/mining-map/oil-live-intel/internal/services/supplier"
)

// NearbySuppliers lists licensed bunker/fuel suppliers near a port LOCODE or map bbox.
func (s *Server) NearbySuppliers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	query := supplier.NearbyQuery{Locode: q.Get("locode"), Limit: limit}

	if query.Locode == "" {
		south, errS := parseOptionalFloat(q.Get("south"))
		west, errW := parseOptionalFloat(q.Get("west"))
		north, errN := parseOptionalFloat(q.Get("north"))
		east, errE := parseOptionalFloat(q.Get("east"))
		if errS != nil || errW != nil || errN != nil || errE != nil {
			writeErr(w, http.StatusBadRequest, "invalid bbox coordinates")
			return
		}
		if south != nil && west != nil && north != nil && east != nil {
			query.South, query.West, query.North, query.East = south, west, north, east
		}
	}

	rows, err := supplier.QueryNearby(r.Context(), s.Pool, query)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"suppliers": rows,
		"limitations": []string{
			"Curated regulator/port registers only — not a global ZoomInfo replacement.",
			"Phones/emails only when published on official registers; no fabricated contacts.",
		},
	})
}

// TriggerBunkerFuelSuppliersSync runs curated bunker register ingest + geocode (admin/on-demand).
func (s *Server) TriggerBunkerFuelSuppliersSync(w http.ResponseWriter, r *http.Request) {
	if s.Config.InternalBroadcastKey == "" || r.Header.Get("X-Oil-Intel-Internal") != s.Config.InternalBroadcastKey {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	result, err := graphsync.IndexBunkerFuelSuppliers(r.Context(), s.Pool, "")
	if err != nil {
		step := map[string]any{"status": "error", "error": err.Error(), "implementation": "go"}
		_ = graphsync.RecordSyncStep(r.Context(), s.Pool, "graphsync_bunker_fuel_suppliers", step)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	payload := map[string]any{
		"status":             "ok",
		"implementation":     "go",
		"suppliers_indexed":  result.SuppliersIndexed,
		"contacts_written":   result.ContactsWritten,
		"records_skipped":    result.RecordsSkipped,
		"seed_hubs":          result.SeedHubs,
		"geocoded":           result.Geocoded,
	}
	if recErr := graphsync.RecordSyncStep(r.Context(), s.Pool, "graphsync_bunker_fuel_suppliers", payload); recErr != nil {
		s.Log.Warn().Err(recErr).Msg("bunker fuel suppliers sync step record failed")
	}
	writeJSON(w, http.StatusOK, payload)
}

func parseOptionalFloat(raw string) (*float64, error) {
	if raw == "" {
		return nil, nil
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return nil, err
	}
	return &v, nil
}
