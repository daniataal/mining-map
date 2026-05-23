package licensemap

import (
	"context"
	"fmt"
	"math"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ClusterMarker is the slim JSON shape for low-zoom license grid cells (parity with Python).
type ClusterMarker struct {
	ID                string   `json:"id"`
	Company           string   `json:"company"`
	LicenseType       string   `json:"licenseType"`
	Commodity         string   `json:"commodity"`
	Status            string   `json:"status"`
	Date              *string  `json:"date"`
	Country           string   `json:"country"`
	Region            string   `json:"region"`
	Sector            string   `json:"sector"`
	Lat               float64  `json:"lat"`
	Lng               float64  `json:"lng"`
	MapClusterCount   int      `json:"mapClusterCount"`
	MapClusterGridDeg float64  `json:"mapClusterGridDeg"`
	EntityKind        string   `json:"entityKind"`
}

// ClusterQuery bounds and filters for license grid aggregation.
type ClusterQuery struct {
	MinLat, MaxLat, MinLng, MaxLng float64
	GridDeg                        float64
	Zoom                           *float64
	Limit                          int
	Sector                         string
	Countries                      []string
	PreferOpenData                 bool
}

func normalizeSector(sector string) string {
	return strings.TrimSpace(strings.ToLower(sector))
}

func expandCountryNames(requested []string) []string {
	aliases := map[string][]string{
		"united arab emirates": {"United Arab Emirates", "UAE"},
		"uae":                  {"United Arab Emirates", "UAE"},
	}
	seen := map[string]struct{}{}
	var out []string
	var add func(string)
	add = func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		key := strings.ToLower(s)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, s)
		if strings.ToLower(s) != s {
			add(strings.ToLower(s))
		}
	}
	for _, c := range requested {
		add(c)
		for _, alias := range aliases[strings.ToLower(strings.TrimSpace(c))] {
			add(alias)
		}
	}
	return out
}

// QueryClusters aggregates licenses into viewport grid cells (Python query_license_clusters parity).
func QueryClusters(ctx context.Context, pool *pgxpool.Pool, q ClusterQuery) ([]ClusterMarker, error) {
	safeLimit := ClusterLimitForZoom(q.Zoom, q.Limit)
	if safeLimit < 1 {
		safeLimit = 1
	}
	if safeLimit > 2000 {
		safeLimit = 2000
	}
	minCnt := ClusterMinCount(q.GridDeg)
	g := q.GridDeg

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

	n := len(args)
	sql := fmt.Sprintf(`
		SELECT
			(FLOOR(lat / $%d) * $%d + $%d / 2.0)::float AS lat,
			(FLOOR(lng / $%d) * $%d + $%d / 2.0)::float AS lng,
			COUNT(*)::int AS cnt,
			MAX(country) AS country,
			MAX(COALESCE(sector, 'mining')) AS sector
		FROM licenses
		WHERE %s
		  AND (%s)
		  AND lat IS NOT NULL AND lng IS NOT NULL
		  AND lat BETWEEN -90 AND 90
		  AND lng BETWEEN -180 AND 180
		  AND NOT (ABS(lat) < 0.05 AND ABS(lng) < 0.05)
		  AND lat BETWEEN $%d AND $%d
		  AND lng BETWEEN $%d AND $%d
		  %s
		GROUP BY FLOOR(lat / $%d), FLOOR(lng / $%d)
		HAVING COUNT(*) >= $%d
		ORDER BY cnt DESC
		LIMIT $%d
	`, n+1, n+2, n+3, n+4, n+5, n+6,
		sectorSQL, countrySQL,
		n+7, n+8, n+9, n+10,
		openClause,
		n+11, n+12,
		n+13,
		n+14)

	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, g, g, g/2, g, g, g/2, q.MinLat, q.MaxLat, q.MinLng, q.MaxLng, g, g, minCnt, safeLimit)

	rows, err := pool.Query(ctx, sql, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ClusterMarker
	for rows.Next() {
		var lat, lng float64
		var cnt int
		var country, sector *string
		if err := rows.Scan(&lat, &lng, &cnt, &country, &sector); err != nil {
			return nil, err
		}
		if cnt < minCnt {
			continue
		}
		c := ""
		if country != nil {
			c = *country
		}
		sec := "mining"
		if sector != nil && *sector != "" {
			sec = *sector
		}
		out = append(out, ClusterMarker{
			ID:                fmt.Sprintf("cluster:%.4f:%.4f", lat, lng),
			Company:           fmt.Sprintf("%d licenses", cnt),
			LicenseType:       "Cluster",
			Commodity:         "",
			Status:            "Active",
			Date:              nil,
			Country:           c,
			Region:            "",
			Sector:            sec,
			Lat:               lat,
			Lng:               lng,
			MapClusterCount:   cnt,
			MapClusterGridDeg: g,
			EntityKind:        "license",
		})
	}
	return MergeClusters(out, g), rows.Err()
}

// ValidBBox returns false for degenerate boxes.
func ValidBBox(minLat, maxLat, minLng, maxLng float64) bool {
	if minLat >= maxLat || minLng >= maxLng {
		return false
	}
	if math.Abs(maxLat-minLat) > 180 || math.Abs(maxLng-minLng) > 360 {
		return false
	}
	return true
}
