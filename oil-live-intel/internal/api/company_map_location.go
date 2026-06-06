package api

import (
	"context"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// companyMapLocationSource mirrors the SQL CASE used when enriching map pins.
func companyMapLocationSource(termLat, mcrLat *float64) string {
	if termLat != nil {
		return "terminal"
	}
	if mcrLat != nil {
		return "corridor"
	}
	return ""
}

// enrichCompanyMapLocations resolves terminal/corridor map pins for a bounded page of companies.
// Laterals run only for the given IDs (typically LIMIT-sized), not the full oil_companies table.
func enrichCompanyMapLocations(ctx context.Context, pool *pgxpool.Pool, items []map[string]any) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(items))
	index := make(map[string]int, len(items))
	for i, item := range items {
		raw, ok := item["id"].(string)
		if !ok || raw == "" {
			continue
		}
		id, err := uuid.Parse(raw)
		if err != nil {
			continue
		}
		ids = append(ids, id)
		index[raw] = i
	}
	if len(ids) == 0 {
		return nil
	}

	rows, err := pool.Query(ctx, `
		SELECT c.id::text,
			COALESCE(term.lat, mcr.lat) AS map_lat,
			COALESCE(term.lon, mcr.lon) AS map_lng,
			term.terminal_id,
			CASE
				WHEN term.lat IS NOT NULL THEN 'terminal'
				WHEN mcr.lat IS NOT NULL THEN 'corridor'
				ELSE NULL
			END AS map_location_source
		FROM oil_companies c
		LEFT JOIN LATERAL (
			SELECT
				ST_Y(t.geom::geometry) AS lat,
				ST_X(t.geom::geometry) AS lon,
				t.id::text AS terminal_id
			FROM oil_terminals t
			WHERE t.geom IS NOT NULL
				AND (
					LOWER(TRIM(COALESCE(t.operator_name, ''))) = LOWER(TRIM(c.name))
					OR LOWER(TRIM(COALESCE(t.owner_name, ''))) = LOWER(TRIM(c.name))
				)
				AND (
					TRIM(COALESCE(c.country, '')) = ''
					OR UPPER(TRIM(c.country)) IN ('UNKNOWN', 'N/A')
					OR LOWER(TRIM(COALESCE(t.country, ''))) = LOWER(TRIM(c.country))
				)
			ORDER BY t.confidence DESC NULLS LAST, t.name
			LIMIT 1
		) term ON true
		LEFT JOIN LATERAL (
			SELECT m.corridor_load_lat AS lat, m.corridor_load_lng AS lon
			FROM meridian_cargo_records m
			WHERE (m.shipper_company_id = c.id OR m.consignee_company_id = c.id)
				AND m.corridor_load_lat IS NOT NULL AND m.corridor_load_lng IS NOT NULL
			ORDER BY m.updated_at DESC NULLS LAST
			LIMIT 1
		) mcr ON true
		WHERE c.id = ANY($1)
	`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		var mapLat, mapLng *float64
		var terminalID, locationSource *string
		if err := rows.Scan(&id, &mapLat, &mapLng, &terminalID, &locationSource); err != nil {
			return err
		}
		if mapLat == nil || mapLng == nil {
			continue
		}
		i, ok := index[id]
		if !ok {
			continue
		}
		items[i]["map_lat"] = *mapLat
		items[i]["map_lng"] = *mapLng
		if terminalID != nil && *terminalID != "" {
			items[i]["map_terminal_id"] = *terminalID
		}
		if locationSource != nil && *locationSource != "" {
			items[i]["map_location_source"] = *locationSource
		}
	}
	return rows.Err()
}

func (s *Server) getCompanyByID(r *http.Request, id string) (map[string]any, error) {
	companyUUID, err := uuid.Parse(id)
	if err != nil {
		return nil, fmt.Errorf("not found")
	}
	items, err := s.listCompanies(r, companyFilters{MinConfidence: 0}, 1, 0, companyListOpts{CompanyID: &companyUUID, IncludeMap: true})
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("not found")
	}
	return items[0], nil
}
