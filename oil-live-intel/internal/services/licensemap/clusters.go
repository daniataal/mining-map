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
	gIdx := n + 1
	halfIdx := n + 2
	minLatIdx := n + 3
	maxLatIdx := n + 4
	minLngIdx := n + 5
	maxLngIdx := n + 6
	minCntIdx := n + 7
	limitIdx := n + 8
	// Subquery keeps PostgreSQL happy: SELECT may reference bucket columns only after GROUP BY.
	sql := fmt.Sprintf(`
		SELECT
			(lat_bucket * $%d + $%d / 2.0)::float AS lat,
			(lng_bucket * $%d + $%d / 2.0)::float AS lng,
			COUNT(*)::int AS cnt,
			country,
			MAX(sector) AS sector
		FROM (
			SELECT
				FLOOR(lat / $%d)::bigint AS lat_bucket,
				FLOOR(lng / $%d)::bigint AS lng_bucket,
				country,
				COALESCE(sector, 'mining') AS sector
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
		) bucketed
		GROUP BY lat_bucket, lng_bucket, country
		HAVING COUNT(*) >= $%d
		ORDER BY cnt DESC
		LIMIT $%d
	`, gIdx, halfIdx, gIdx, halfIdx, gIdx, gIdx,
		sectorSQL, countrySQL,
		minLatIdx, maxLatIdx, minLngIdx, maxLngIdx,
		openClause,
		minCntIdx,
		limitIdx)

	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, g, g/2, q.MinLat, q.MaxLat, q.MinLng, q.MaxLng, minCnt, safeLimit)

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
			ID:                fmt.Sprintf("cluster:%s:%.4f:%.4f", c, lat, lng),
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
	merged := MergeClusters(out, g)
	return CollapseClustersTightViewport(merged, q.MinLat, q.MaxLat, q.MinLng, q.MaxLng, q.Zoom), rows.Err()
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
