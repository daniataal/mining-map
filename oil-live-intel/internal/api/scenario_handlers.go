package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

type crisisScenarioRow struct {
	ID              string          `json:"id"`
	Slug            string          `json:"slug"`
	Title           string          `json:"title"`
	MinLat          float64         `json:"min_lat"`
	MinLng          float64         `json:"min_lng"`
	MaxLat          float64         `json:"max_lat"`
	MaxLng          float64         `json:"max_lng"`
	WatchZoneIDs    []string        `json:"watch_zone_ids"`
	ProductFilter   *string         `json:"product_filter,omitempty"`
	AssumptionsJSON json.RawMessage `json:"assumptions_json"`
}

// ListCrisisScenarios GET /api/oil-live/scenarios
func (s *Server) ListCrisisScenarios(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Pool.Query(r.Context(), `
		SELECT id::text, slug, title, min_lat, min_lng, max_lat, max_lng,
			watch_zone_ids, product_filter, assumptions_json
		FROM crisis_scenarios
		ORDER BY title ASC
	`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	out := make([]crisisScenarioRow, 0)
	for rows.Next() {
		var row crisisScenarioRow
		if err := rows.Scan(
			&row.ID, &row.Slug, &row.Title,
			&row.MinLat, &row.MinLng, &row.MaxLat, &row.MaxLng,
			&row.WatchZoneIDs, &row.ProductFilter, &row.AssumptionsJSON,
		); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		out = append(out, row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"scenarios": out, "count": len(out)})
}

// ScenarioDigest GET /api/oil-live/scenarios/{slug}/digest
func (s *Server) ScenarioDigest(w http.ResponseWriter, r *http.Request) {
	slug := strings.TrimSpace(chi.URLParam(r, "slug"))
	if slug == "" {
		writeErr(w, http.StatusBadRequest, "slug required")
		return
	}
	var sc crisisScenarioRow
	err := s.Pool.QueryRow(r.Context(), `
		SELECT id::text, slug, title, min_lat, min_lng, max_lat, max_lng,
			watch_zone_ids, product_filter, assumptions_json
		FROM crisis_scenarios WHERE slug = $1
	`, slug).Scan(
		&sc.ID, &sc.Slug, &sc.Title,
		&sc.MinLat, &sc.MinLng, &sc.MaxLat, &sc.MaxLng,
		&sc.WatchZoneIDs, &sc.ProductFilter, &sc.AssumptionsJSON,
	)
	if err != nil {
		writeErr(w, http.StatusNotFound, "scenario not found")
		return
	}

	sync := querySyncStatus(r.Context(), s.Pool)
	watchZones := queryWatchZoneObservations24h(r.Context(), s.Pool)
	filteredWatch := make([]WatchZoneObservation24h, 0)
	zoneSet := map[string]bool{}
	for _, id := range sc.WatchZoneIDs {
		zoneSet[id] = true
	}
	for _, z := range watchZones {
		if len(zoneSet) == 0 || zoneSet[z.ZoneID] {
			filteredWatch = append(filteredWatch, z)
		}
	}

	commodity := ""
	if sc.ProductFilter != nil {
		commodity = strings.TrimSpace(*sc.ProductFilter)
	}
	topCorridors := queryTopCorridorsInBbox(
		r.Context(), s.Pool, sc.MinLat, sc.MinLng, sc.MaxLat, sc.MaxLng, commodity, 15,
	)

	topOpps := []map[string]any{}
	oppRows, err := s.Pool.Query(r.Context(), `
		SELECT id::text, title, COALESCE(deal_score, confidence)::float8,
			COALESCE(signal_json->>'signal_kind', opportunity_type),
			status
		FROM oil_opportunities
		WHERE status = 'open'
		ORDER BY COALESCE(deal_score, confidence) DESC NULLS LAST
		LIMIT 15
	`)
	if err == nil {
		defer oppRows.Close()
		for oppRows.Next() {
			var id, title, kind, status string
			var score float64
			if oppRows.Scan(&id, &title, &score, &kind, &status) == nil {
				topOpps = append(topOpps, map[string]any{
					"id": id, "title": title, "deal_score": score,
					"signal_kind": kind, "status": status,
				})
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"scenario":                      sc,
		"sync_status":                   sync,
		"watch_zone_observations_24h":   filteredWatch,
		"manifest_by_tier":              sync.ManifestByTier,
		"mcr_by_tier":                   sync.McrByTier,
		"open_opportunity_count":        sync.OpenOpportunityCount,
		"top_opportunities":             topOpps,
		"top_corridors":                 topCorridors,
		"disclaimer":                    "Crisis digest — inferred/synthetic tiers; Gulf AIS may be sparse. Not executable deal confirmation.",
	})
}
