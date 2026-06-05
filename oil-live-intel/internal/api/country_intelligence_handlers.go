package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

// CountryIntelligence aggregates license, port, vessel and operator signals for one country.
func (s *Server) CountryIntelligence(w http.ResponseWriter, r *http.Request) {
	country := strings.TrimSpace(chi.URLParam(r, "country"))
	if country == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "country_required"})
		return
	}
	if s.Pool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database_unavailable"})
		return
	}

	ctx := r.Context()
	norm := normalizeCountryName(country)

	var miningCount, oilCount, totalCount int
	_ = s.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(NULLIF(TRIM(sector), ''), 'mining'))) = 'mining')::int,
			COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(NULLIF(TRIM(sector), ''), 'mining'))) = 'oil_and_gas')::int,
			COUNT(*)::int
		FROM licenses
		WHERE LOWER(TRIM(country)) = LOWER(TRIM($1))
		   OR LOWER(TRIM(country)) = $2
	`, country, norm).Scan(&miningCount, &oilCount, &totalCount)

	var portCount int
	_ = s.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM licenses
		WHERE (LOWER(TRIM(country)) = LOWER(TRIM($1)) OR LOWER(TRIM(country)) = $2)
		  AND (
		    LOWER(COALESCE(entity_subtype, '')) LIKE '%port%'
		    OR LOWER(COALESCE(license_type, '')) LIKE '%port%'
		    OR LOWER(COALESCE(commodity, '')) LIKE '%port%'
		  )
	`, country, norm).Scan(&portCount)

	var vesselCount *int
	var vesselNote string
	var stored int
	var latestAge *float64
	err := s.Pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT mmsi)::int, EXTRACT(EPOCH FROM (now() - MAX(ts)))::float8
		FROM oil_ais_positions WHERE ts > now() - interval '24 hours'
	`).Scan(&stored, &latestAge)
	if err == nil && stored > 0 {
		vesselNote = "Global AIS snapshot — country-level vessel attribution is limited; count reflects stored positions only."
		v := stored
		if v > 0 {
			vesselCount = &v
		}
	} else {
		vesselNote = "No recent AIS positions in store — maritime coverage may be sparse."
	}

	type operatorRow struct {
		Company string `json:"company"`
		Count   int    `json:"count"`
		Sector  string `json:"sector"`
	}
	var operators []operatorRow
	rows, err := s.Pool.Query(ctx, `
		SELECT TRIM(company) AS company,
		       COUNT(*)::int AS cnt,
		       LOWER(TRIM(COALESCE(NULLIF(TRIM(sector), ''), 'mining'))) AS sector
		FROM licenses
		WHERE (LOWER(TRIM(country)) = LOWER(TRIM($1)) OR LOWER(TRIM(country)) = $2)
		  AND TRIM(COALESCE(company, '')) <> ''
		GROUP BY TRIM(company), sector
		ORDER BY cnt DESC
		LIMIT 8
	`, country, norm)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var o operatorRow
			if rows.Scan(&o.Company, &o.Count, &o.Sector) == nil && o.Company != "" {
				operators = append(operators, o)
			}
		}
	}
	if operators == nil {
		operators = []operatorRow{}
	}

	tradeSignals := []map[string]any{}
	var corridorCount int
	_ = s.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM mcr_trade_flows
		WHERE LOWER(load_country) = LOWER(TRIM($1))
		   OR LOWER(discharge_country) = LOWER(TRIM($1))
	`, country).Scan(&corridorCount)
	if corridorCount > 0 {
		tradeSignals = append(tradeSignals, map[string]any{
			"label": "MCR corridor flows",
			"value": corridorCount,
			"tier":  "inferred",
		})
	}

	writeJSONCached(w, http.StatusOK, map[string]any{
		"country": country,
		"license_counts": map[string]int{
			"mining":      miningCount,
			"oil_and_gas": oilCount,
			"total":       totalCount,
		},
		"port_count":            portCount,
		"vessel_count":          vesselCount,
		"vessel_coverage_note":  vesselNote,
		"top_operators":         operators,
		"trade_signals":         tradeSignals,
		"data_tier":             "open_data_aggregate",
		"disclaimer":            "Counts from stored licenses and inferred trade flows. AIS vessel counts are global-store snapshots, not country-attributed traffic.",
		"runtime":               "go",
	}, 60)
}
