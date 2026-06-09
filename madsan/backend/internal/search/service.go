package search

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

type Result struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	EntityType      string   `json:"entity_type"`
	CountryCode     string   `json:"country_code,omitempty"`
	AssetType       string   `json:"asset_type,omitempty"`
	MMSI            string   `json:"mmsi,omitempty"`
	ConfidenceScore *float64 `json:"confidence_score,omitempty"`
	Latitude        *float64 `json:"latitude,omitempty"`
	Longitude       *float64 `json:"longitude,omitempty"`
	Subtitle        string   `json:"subtitle,omitempty"`
}

func (s *Service) Handle(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 2 {
		writeJSON(w, []Result{})
		return
	}
	vertical := r.URL.Query().Get("vertical")
	types := parseTypes(r.URL.Query().Get("types"))
	limit := 25

	var out []Result
	if types["company"] {
		out = append(out, s.searchCompanies(r, q, vertical, limit)...)
	}
	if types["asset"] {
		out = append(out, s.searchAssets(r, q, vertical, limit)...)
	}
	if types["vessel"] {
		out = append(out, s.searchVessels(r, q, limit)...)
	}
	sort.Slice(out, func(i, j int) bool {
		ci, cj := out[i].ConfidenceScore, out[j].ConfidenceScore
		if ci == nil {
			return false
		}
		if cj == nil {
			return true
		}
		return *ci > *cj
	})
	if len(out) > limit {
		out = out[:limit]
	}
	writeJSON(w, out)
}

func parseTypes(raw string) map[string]bool {
	all := map[string]bool{"company": true, "asset": true, "vessel": true}
	if raw == "" {
		return all
	}
	out := map[string]bool{}
	for _, t := range strings.Split(raw, ",") {
		out[strings.TrimSpace(t)] = true
	}
	if len(out) == 0 {
		return all
	}
	return out
}

func (s *Service) searchCompanies(r *http.Request, q, vertical string, limit int) []Result {
	rows, err := s.pool.Query(r.Context(), `
		SELECT DISTINCT ON (normalized_name) id, name, COALESCE(country_code,''), confidence_score
		FROM companies
		WHERE name ILIKE '%' || $1 || '%' OR normalized_name ILIKE '%' || lower($1) || '%'
		ORDER BY normalized_name, confidence_score DESC NULLS LAST, length(country_code) ASC
		LIMIT $2
	`, q, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	return collectCompanyRows(rows, vertical)
}

func collectCompanyRows(rows interface {
	Next() bool
	Scan(dest ...any) error
}, vertical string) []Result {
	var out []Result
	for rows.Next() {
		var id uuid.UUID
		var name, country string
		var conf *float64
		if rows.Scan(&id, &name, &country, &conf) != nil {
			continue
		}
		if vertical == "metals" {
			continue
		}
		out = append(out, Result{
			ID: id.String(), Name: name, EntityType: "company", CountryCode: country,
			ConfidenceScore: conf, Subtitle: "Supplier · " + country,
		})
	}
	return out
}

func (s *Service) searchAssets(r *http.Request, q, vertical string, limit int) []Result {
	typeFilter := energyAssetTypes()
	if vertical == "metals" {
		typeFilter = metalsAssetTypes()
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT DISTINCT ON (normalized_name, asset_type) id, name, COALESCE(country_code,''), asset_type, confidence_score, latitude, longitude
		FROM assets
		WHERE (name ILIKE '%' || $1 || '%' OR normalized_name ILIKE '%' || lower($1) || '%')
		  AND asset_type = ANY($2)
		  AND latitude IS NOT NULL
		ORDER BY normalized_name, asset_type, confidence_score DESC NULLS LAST
		LIMIT $3
	`, q, typeFilter, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Result
	for rows.Next() {
		var id uuid.UUID
		var name, country, assetType string
		var conf, lat, lng *float64
		if rows.Scan(&id, &name, &country, &assetType, &conf, &lat, &lng) != nil {
			continue
		}
		out = append(out, Result{
			ID: id.String(), Name: name, EntityType: "asset", CountryCode: country,
			AssetType: assetType, ConfidenceScore: conf, Latitude: lat, Longitude: lng,
			Subtitle: assetType + " · " + country,
		})
	}
	return out
}

func (s *Service) searchVessels(r *http.Request, q string, limit int) []Result {
	rows, err := s.pool.Query(r.Context(), `
		SELECT DISTINCT ON (COALESCE(NULLIF(mmsi,''), id::text)) id, COALESCE(name,''), COALESCE(mmsi,''), COALESCE(vessel_type,''),
		       confidence_score, latitude, longitude
		FROM vessels
		WHERE name ILIKE '%' || $1 || '%' OR mmsi = $1
		ORDER BY COALESCE(NULLIF(mmsi,''), id::text), last_seen_at DESC NULLS LAST, confidence_score DESC NULLS LAST
		LIMIT $2
	`, q, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Result
	for rows.Next() {
		var id uuid.UUID
		var name, mmsi, vtype string
		var conf, lat, lng *float64
		if rows.Scan(&id, &name, &mmsi, &vtype, &conf, &lat, &lng) != nil {
			continue
		}
		sub := vtype
		if mmsi != "" {
			sub = "MMSI " + mmsi
		}
		out = append(out, Result{
			ID: id.String(), Name: name, EntityType: "vessel", MMSI: mmsi,
			AssetType: vtype, ConfidenceScore: conf, Latitude: lat, Longitude: lng,
			Subtitle: sub,
		})
	}
	return out
}

func energyAssetTypes() []string {
	return []string{"tank_farm", "terminal", "refinery", "pipeline", "port", "sts_zone", "storage", "berth"}
}

func metalsAssetTypes() []string {
	return []string{"mine", "smelter", "refinery", "processing_plant", "port"}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
