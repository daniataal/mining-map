package licensemap

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CountrySummaryRow is one country hub for low-zoom license maps.
type CountrySummaryRow struct {
	Country string  `json:"country"`
	Count   int     `json:"count"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
}

// CountrySummaryQuery bounds and filters for per-country aggregation.
type CountrySummaryQuery struct {
	MinLat, MaxLat, MinLng, MaxLng float64
	Limit                          int
	Sector                         string
	Countries                      []string
	PreferOpenData                 bool
}

// QueryCountrySummary aggregates licenses by country in the viewport (median coords + land snap).
func QueryCountrySummary(ctx context.Context, pool *pgxpool.Pool, q CountrySummaryQuery) ([]CountrySummaryRow, error) {
	safeLimit := q.Limit
	if safeLimit < 1 {
		safeLimit = 120
	}
	if safeLimit > 200 {
		safeLimit = 200
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
		openClause = fmt.Sprintf(` AND (
			LOWER(TRIM(COALESCE(record_origin, ''))) <> 'bundled_json'
			OR country IS NULL
			OR country NOT IN (
				SELECT country FROM licenses
				WHERE LOWER(TRIM(COALESCE(record_origin, ''))) IN ('open_data', 'global_open_fallback')
				AND country IS NOT NULL
				AND %s
			)
		)`, sectorSQL)
	}

	n := len(args)
	minLatIdx := n + 1
	maxLatIdx := n + 2
	minLngIdx := n + 3
	maxLngIdx := n + 4
	limitIdx := n + 5

	sql := fmt.Sprintf(`
		SELECT
			country,
			COUNT(*)::int AS cnt,
			(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lat))::float AS lat,
			(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lng))::float AS lng
		FROM licenses
		WHERE %s
		  AND (%s)
		  AND country IS NOT NULL AND TRIM(country) <> ''
		  AND lat IS NOT NULL AND lng IS NOT NULL
		  AND lat BETWEEN -90 AND 90
		  AND lng BETWEEN -180 AND 180
		  AND NOT (ABS(lat) < 0.05 AND ABS(lng) < 0.05)
		  AND lat BETWEEN $%d AND $%d
		  AND lng BETWEEN $%d AND $%d
		  %s
		GROUP BY country
		ORDER BY cnt DESC
		LIMIT $%d
	`, sectorSQL, countrySQL,
		minLatIdx, maxLatIdx, minLngIdx, maxLngIdx,
		openClause,
		limitIdx)

	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, q.MinLat, q.MaxLat, q.MinLng, q.MaxLng, safeLimit)

	rows, err := pool.Query(ctx, sql, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CountrySummaryRow
	for rows.Next() {
		var country string
		var cnt int
		var lat, lng float64
		if err := rows.Scan(&country, &cnt, &lat, &lng); err != nil {
			return nil, err
		}
		if cnt < 1 {
			continue
		}
		lat, lng = RefineClusterLandPosition(lat, lng, country)
		out = append(out, CountrySummaryRow{
			Country: country,
			Count:   cnt,
			Lat:     lat,
			Lng:     lng,
		})
	}
	return out, rows.Err()
}
