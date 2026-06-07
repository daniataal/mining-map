package api

import (
	"encoding/json"
	"net/http"
	"strings"
)

// SearchLicenses handles GET /licenses/search for broker workspace imports.
func (s *Server) SearchLicenses(w http.ResponseWriter, r *http.Request) {
	if s.Pool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "database_unavailable",
		})
		return
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	resp := map[string]any{
		"hits":  []SearchHit{},
		"total": 0,
		"query": q,
	}
	if q == "" {
		writeJSON(w, http.StatusOK, resp)
		return
	}

	limit := queryInt(r, "limit", 20)
	if limit < 1 {
		limit = 1
	}
	if limit > 50 {
		limit = 50
	}

	args := []any{"%" + q + "%", limit}
	sectorClause := ""
	if sector := strings.TrimSpace(r.URL.Query().Get("sector")); sector != "" {
		args = append(args, sector)
		sectorClause = " AND COALESCE(sector, '') = $3"
	}

	rows, err := s.Pool.Query(r.Context(), `
		SELECT
			id,
			COALESCE(company, ''),
			COALESCE(country, ''),
			COALESCE(region, ''),
			COALESCE(commodity, ''),
			COALESCE(license_type, ''),
			COALESCE(status, ''),
			lat,
			lng,
			COALESCE(sector, ''),
			COALESCE(record_origin, ''),
			COALESCE(source_name, '')
		FROM licenses
		WHERE (
			id ILIKE $1
			OR COALESCE(company, '') ILIKE $1
			OR COALESCE(country, '') ILIKE $1
			OR COALESCE(region, '') ILIKE $1
			OR COALESCE(commodity, '') ILIKE $1
			OR COALESCE(license_type, '') ILIKE $1
			OR COALESCE(status, '') ILIKE $1
			OR COALESCE(source_name, '') ILIKE $1
		)`+sectorClause+`
		ORDER BY
			CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 0 ELSE 1 END,
			company,
			country
		LIMIT $2
	`, args...)
	if err != nil {
		s.Log.Error().Err(err).Msg("license search")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query_failed"})
		return
	}
	defer rows.Close()

	hits := []SearchHit{}
	for rows.Next() {
		var id, company, country, region, commodity, licenseType, status, sector, origin, sourceName string
		var lat, lng *float64
		if err := rows.Scan(
			&id,
			&company,
			&country,
			&region,
			&commodity,
			&licenseType,
			&status,
			&lat,
			&lng,
			&sector,
			&origin,
			&sourceName,
		); err != nil {
			s.Log.Warn().Err(err).Msg("scan license search row")
			continue
		}
		displayName := strings.TrimSpace(company)
		if displayName == "" {
			displayName = id
		}
		source := map[string]any{
			"id":            id,
			"name":          displayName,
			"company":       company,
			"country":       country,
			"region":        region,
			"commodity":     commodity,
			"license_type":  licenseType,
			"status":        status,
			"sector":        sector,
			"record_origin": origin,
			"source_name":   sourceName,
			"mappable":      lat != nil && lng != nil,
		}
		if lat != nil {
			source["lat"] = *lat
		}
		if lng != nil {
			source["lng"] = *lng
		}
		rawSource := jsonMarshalRaw(source)
		hits = append(hits, SearchHit{
			Type:   "license",
			ID:     id,
			Source: rawSource,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"hits":  hits,
		"total": len(hits),
		"query": q,
	})
}

func jsonMarshalRaw(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(b)
}
