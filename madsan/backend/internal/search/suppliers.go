package search

import (
	"context"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/intelligence"
)

const defaultSupplierRadiusKm = 250

// SupplierSearchParams are fusion query filters for ranked supplier discovery.
type SupplierSearchParams struct {
	Query       string
	Commodity   string
	CountryCode string
	NearLat     float64
	NearLon     float64
	RadiusKm    float64
	Limit       int
}

// SupplierResult is one ranked supplier row from fusion search.
type SupplierResult struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	CountryCode       string   `json:"country_code,omitempty"`
	Commodities       []string `json:"commodities"`
	ConfidenceScore   float64  `json:"confidence_score"`
	EvidenceCount     int      `json:"evidence_count"`
	ContactCount      int      `json:"contact_count,omitempty"`
	DataQualityStatus string   `json:"data_quality_status,omitempty"`
	Tier              string   `json:"tier"`
	RankScore         float64  `json:"rank_score"`
	DistanceKm        *float64 `json:"distance_km,omitempty"`
}

// ParseSupplierSearchParams reads optional fusion filters from the query string.
func ParseSupplierSearchParams(r *http.Request) SupplierSearchParams {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	commodity := strings.TrimSpace(r.URL.Query().Get("commodity"))
	country := strings.TrimSpace(r.URL.Query().Get("country_code"))
	if country == "" {
		country = strings.TrimSpace(r.URL.Query().Get("country"))
	}
	nearLat, _ := strconv.ParseFloat(strings.TrimSpace(r.URL.Query().Get("near_lat")), 64)
	nearLon, _ := strconv.ParseFloat(strings.TrimSpace(r.URL.Query().Get("near_lon")), 64)
	radiusKm, _ := strconv.ParseFloat(strings.TrimSpace(r.URL.Query().Get("radius_km")), 64)
	if nearLat != 0 && nearLon != 0 && radiusKm <= 0 {
		radiusKm = defaultSupplierRadiusKm
	}
	limit := 30
	return SupplierSearchParams{
		Query: q, Commodity: commodity, CountryCode: country,
		NearLat: nearLat, NearLon: nearLon, RadiusKm: radiusKm, Limit: limit,
	}
}

// SupplierFusionRank combines confidence, evidence depth, contacts, commodity fit, and proximity.
func SupplierFusionRank(confidence float64, evidenceCount, contactCount int, commodityQuery string, commodities []string, distanceKm *float64, radiusKm float64) float64 {
	score := confidence * 0.40
	score += math.Min(float64(evidenceCount)*4, 25)
	score += math.Min(float64(contactCount)*8, 16)
	if commodityMatches(commodityQuery, commodities) {
		score += 15
	}
	if distanceKm != nil && radiusKm > 0 && *distanceKm <= radiusKm {
		score += 10 * (1 - *distanceKm/radiusKm)
	}
	return math.Round(score*100) / 100
}

func commodityMatches(query string, commodities []string) bool {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return false
	}
	for _, c := range commodities {
		cl := strings.ToLower(strings.TrimSpace(c))
		if cl == q || strings.Contains(cl, q) || strings.Contains(q, cl) {
			return true
		}
	}
	return false
}

// SearchSuppliers runs fusion-ranked supplier discovery over normalized master data.
func SearchSuppliers(ctx context.Context, pool *pgxpool.Pool, p SupplierSearchParams) ([]SupplierResult, error) {
	geoActive := p.NearLat != 0 && p.NearLon != 0 && p.RadiusKm > 0
	rows, err := pool.Query(ctx, `
		WITH supplier_base AS (
			SELECT
				c.id,
				c.name,
				c.country_code,
				c.commodities,
				COALESCE(c.confidence_score, 0) AS confidence_score,
				c.data_quality_status,
				COUNT(DISTINCT ct.id)::int AS contact_count,
				(SELECT COUNT(*)::int
				 FROM evidence e
				 WHERE e.entity_type = 'company' AND e.entity_id = c.id) AS evidence_count,
				AVG(a.latitude) AS centroid_lat,
				AVG(a.longitude) AS centroid_lng
			FROM companies c
			LEFT JOIN contacts ct ON ct.company_id = c.id
			LEFT JOIN assets a ON a.operator_company_id = c.id AND a.latitude IS NOT NULL
			WHERE c.company_type = 'supplier' OR 'supplier' = ANY(c.commodities)
			GROUP BY c.id
		),
		scored AS (
			SELECT
				id, name, country_code, commodities, confidence_score, data_quality_status,
				contact_count, evidence_count, centroid_lat, centroid_lng,
				CASE
					WHEN $4 <> 0 AND $5 <> 0 AND centroid_lat IS NOT NULL AND centroid_lng IS NOT NULL THEN
						6371.0 * acos(LEAST(1.0, GREATEST(-1.0,
							cos(radians($4)) * cos(radians(centroid_lat))
							* cos(radians(centroid_lng) - radians($5))
							+ sin(radians($4)) * sin(radians(centroid_lat))
						)))
				END AS distance_km
			FROM supplier_base
		)
		SELECT id, name, country_code, commodities, confidence_score, data_quality_status,
		       contact_count, evidence_count, distance_km
		FROM scored
		WHERE ($1 = '' OR name ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR EXISTS (
				SELECT 1 FROM unnest(commodities) cm
				WHERE lower(cm) = lower($2) OR lower(cm) LIKE '%' || lower($2) || '%'
		  ))
		  AND ($3 = '' OR country_code ILIKE $3)
		  AND (
				NOT $6 OR distance_km IS NULL OR distance_km <= $7
		  )
		LIMIT 120
	`, p.Query, p.Commodity, p.CountryCode, p.NearLat, p.NearLon, geoActive, p.RadiusKm)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SupplierResult
	for rows.Next() {
		var sr SupplierResult
		var id uuid.UUID
		var countryCode *string
		var commodities []string
		var dist *float64
		if err := rows.Scan(&id, &sr.Name, &countryCode, &commodities, &sr.ConfidenceScore,
			&sr.DataQualityStatus, &sr.ContactCount, &sr.EvidenceCount, &dist); err != nil {
			continue
		}
		sr.ID = id.String()
		sr.CountryCode = derefString(countryCode)
		sr.Commodities = commodities
		sr.DistanceKm = dist
		sr.Tier = intelligence.SupplierDiscoveryTier(sr.ConfidenceScore, sr.EvidenceCount)
		sr.RankScore = SupplierFusionRank(sr.ConfidenceScore, sr.EvidenceCount, sr.ContactCount,
			p.Commodity, commodities, dist, p.RadiusKm)
		out = append(out, sr)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].RankScore != out[j].RankScore {
			return out[i].RankScore > out[j].RankScore
		}
		if out[i].EvidenceCount != out[j].EvidenceCount {
			return out[i].EvidenceCount > out[j].EvidenceCount
		}
		return out[i].Name < out[j].Name
	})
	if p.Limit > 0 && len(out) > p.Limit {
		out = out[:p.Limit]
	}
	return out, nil
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
