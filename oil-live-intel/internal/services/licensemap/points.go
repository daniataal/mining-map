package licensemap

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mining-map/oil-live-intel/internal/models"
)

// PointQuery bounds and filters for raw license row fetch.
type PointQuery struct {
	MinLat, MaxLat, MinLng, MaxLng float64
	HasBBox                        bool
	Limit                          int
	Sector                         string
	Countries                      []string
	PreferOpenData                 bool
}

// QueryPoints fetches individual license rows, handling bbox capping or full-table scans.
func QueryPoints(ctx context.Context, pool *pgxpool.Pool, q PointQuery) ([]models.License, error) {
	safeLimit := q.Limit
	if safeLimit < 1 {
		safeLimit = 10000
	}
	if safeLimit > 15000 {
		safeLimit = 15000
	}

	sectorSQL := "TRUE"
	var args []any
	if sec := normalizeSector(q.Sector); sec != "" {
		sectorSQL = "LOWER(TRIM(COALESCE(NULLIF(TRIM(sector), ''), 'mining'))) = $1"
		args = append(args, sec)
	}

	countrySQL := "TRUE"
	countries := expandCountryNames(q.Countries)
	if len(countries) > 0 {
		lower := make([]string, len(countries))
		for i, c := range countries {
			lower[i] = strings.ToLower(c)
		}
		n := len(args)
		countrySQL = fmt.Sprintf("(country = ANY($%d) OR LOWER(country) = ANY($%d))", n+1, n+2)
		args = append(args, countries, lower)
	}

	openClause := ""
	if q.PreferOpenData {
		existsSQL := fmt.Sprintf(`
			SELECT EXISTS (
				SELECT 1 FROM licenses
				WHERE %s AND (%s)
				  AND LOWER(TRIM(COALESCE(record_origin, ''))) IN ('open_data', 'global_open_fallback')
			)`, sectorSQL, countrySQL)
		var hasPreferred bool
		if err := pool.QueryRow(ctx, existsSQL, args...).Scan(&hasPreferred); err != nil {
			return nil, err
		}
		if hasPreferred {
			openClause = " AND LOWER(TRIM(COALESCE(record_origin, ''))) <> 'bundled_json' "
		}
	}

	columns := `id, company, license_type, commodity, status, date_issued, country, region, 
		sector, lat, lng, phone_number, contact_person, record_origin, source_id, 
		source_name, source_url, source_record_url, source_updated_at, last_synced_at, 
		source_kind, entity_kind, entity_subtype, confidence_score, confidence_note, 
		geo_source, geo_approximated, geo_confidence, original_lat, original_lng, 
		CASE WHEN char_length(COALESCE(raw_payload, '')) <= 2048 THEN raw_payload END AS raw_payload_lite`

	var sql string
	if q.HasBBox {
		n := len(args)
		if len(countries) > 1 {
			sql = fmt.Sprintf(`
				SELECT %s FROM (
					SELECT %s, ROW_NUMBER() OVER (PARTITION BY country ORDER BY id) AS rn
					FROM licenses
					WHERE %s AND (%s)
					  AND lat IS NOT NULL AND lng IS NOT NULL
					  AND lat BETWEEN $%d AND $%d
					  AND lng BETWEEN $%d AND $%d
					  %s
				) ranked
				WHERE ranked.rn <= $%d
			`, columns, columns, sectorSQL, countrySQL, n+1, n+2, n+3, n+4, openClause, n+5)
			args = append(args, q.MinLat, q.MaxLat, q.MinLng, q.MaxLng, safeLimit)
		} else {
			sql = fmt.Sprintf(`
				SELECT %s FROM licenses
				WHERE %s AND (%s)
				  AND lat IS NOT NULL AND lng IS NOT NULL
				  AND lat BETWEEN $%d AND $%d
				  AND lng BETWEEN $%d AND $%d
				  %s
				ORDER BY id
				LIMIT $%d
			`, columns, sectorSQL, countrySQL, n+1, n+2, n+3, n+4, openClause, n+5)
			args = append(args, q.MinLat, q.MaxLat, q.MinLng, q.MaxLng, safeLimit)
		}
	} else {
		n := len(args)
		sql = fmt.Sprintf(`
			SELECT %s FROM licenses
			WHERE %s AND (%s)
			  AND lat IS NOT NULL AND lng IS NOT NULL
			  %s
			ORDER BY id
			LIMIT $%d
		`, columns, sectorSQL, countrySQL, openClause, n+1)
		args = append(args, safeLimit)
	}

	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return pgx.CollectRows(rows, pgx.RowToStructByNameLax[models.License])
}
