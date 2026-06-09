package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/assets"
	"github.com/madsan/intelligence/internal/deals"
	"github.com/madsan/intelligence/internal/intelligence"
)

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
		TenantSlug  string `json:"tenant_slug"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := s.auth.Register(r.Context(), body.Email, body.Password, body.DisplayName, body.TenantSlug); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]string{"status": "registered"})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	access, refresh, err := s.auth.Login(r.Context(), body.Email, body.Password)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	s.auth.SetAuthCookies(w, access, refresh)
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	claims, err := s.auth.ParseRequest(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	writeJSON(w, claims)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	s.auth.ClearAuthCookies(w)
	writeJSON(w, map[string]string{"status": "logged_out"})
}

func (s *Server) listEnergyAssets(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 200)
	minLat := queryFloat(r, "min_lat")
	maxLat := queryFloat(r, "max_lat")
	minLng := queryFloat(r, "min_lng")
	maxLng := queryFloat(r, "max_lng")
	rows, err := s.pool.Query(r.Context(), `
		SELECT id, name, asset_type, country_code, latitude, longitude, confidence_score, operator_name
		FROM map_energy_assets
		WHERE ($1::float8 IS NULL OR latitude >= $1)
		  AND ($2::float8 IS NULL OR latitude <= $2)
		  AND ($3::float8 IS NULL OR longitude >= $3)
		  AND ($4::float8 IS NULL OR longitude <= $4)
		ORDER BY confidence_score DESC NULLS LAST LIMIT $5
	`, minLat, maxLat, minLng, maxLng, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var name, assetType, country, operator *string
		var lat, lng, conf *float64
		_ = rows.Scan(&id, &name, &assetType, &country, &lat, &lng, &conf, &operator)
		out = append(out, map[string]any{
			"id": id.String(), "name": name, "asset_type": assetType,
			"country_code": country, "latitude": lat, "longitude": lng,
			"confidence_score": conf, "operator_name": operator,
		})
	}
	writeJSON(w, out)
}

func (s *Server) listMetalsAssets(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 200)
	rows, err := s.pool.Query(r.Context(), `
		SELECT id, name, asset_type, country_code, latitude, longitude, confidence_score
		FROM map_metals_assets ORDER BY confidence_score DESC NULLS LAST LIMIT $1
	`, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var name, assetType, country *string
		var lat, lng, conf *float64
		_ = rows.Scan(&id, &name, &assetType, &country, &lat, &lng, &conf)
		out = append(out, map[string]any{
			"id": id.String(), "name": name, "asset_type": assetType,
			"country_code": country, "latitude": lat, "longitude": lng, "confidence_score": conf,
		})
	}
	writeJSON(w, out)
}

func (s *Server) getAsset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	uid, err := uuid.Parse(id)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	var name, assetType, country, status string
	var lat, lng, conf float64
	var rawPayload []byte
	var geomType string
	var commodities []string
	err = s.pool.QueryRow(r.Context(), `
		SELECT name, asset_type, COALESCE(country_code,''), latitude, longitude, confidence_score, data_quality_status,
		       raw_source_payload, COALESCE(ST_GeometryType(geom::geometry), ''), commodities_supported
		FROM assets WHERE id = $1
	`, id).Scan(&name, &assetType, &country, &lat, &lng, &conf, &status, &rawPayload, &geomType, &commodities)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	evidence, _ := loadEvidence(r.Context(), s.pool, "asset", uid)
	summary := map[string]any{"asset_type": assetType, "country": country}
	enrichAssetSummary(summary, assetType, commodities, rawPayload, geomType)
	resp := CoreEntityResponse{
		ID: id, EntityType: "asset", Name: name,
		Summary:     summary,
		Location:    map[string]any{"latitude": lat, "longitude": lng},
		Confidence:  ConfidenceBlock{Score: conf, Status: status},
		Evidence:    evidence,
		Limitations: []string{"Verify against source evidence before deal execution"},
	}
	attachAssetSignals(&resp, assetType, commodities)
	resp.SignalHistory = loadSignalHistory(r.Context(), s.pool, "asset", uid, 15)
	resp.Relationships = loadRelationships(r.Context(), s.pool, "asset", uid)
	writeJSON(w, resp)
}

func (s *Server) getCompany(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	uid, err := uuid.Parse(id)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	var name, country, status string
	var commodities []string
	var conf float64
	err = s.pool.QueryRow(r.Context(), `
		SELECT name, COALESCE(country_code,''), commodities, confidence_score, data_quality_status
		FROM companies WHERE id = $1
	`, id).Scan(&name, &country, &commodities, &conf, &status)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	evidence, _ := loadEvidence(r.Context(), s.pool, "company", uid)
	loc := companyCentroid(r.Context(), s.pool, uid)
	resp := CoreEntityResponse{
		ID: id, EntityType: "company", Name: name,
		Summary:     map[string]any{"country": country, "commodities": commodities},
		Location:    loc,
		Confidence:  ConfidenceBlock{Score: conf, Status: status},
		Evidence:    evidence,
		Limitations: []string{"Supplier intelligence — verify register tier and contact channels independently"},
	}
	attachCompanySignals(&resp, commodities)
	resp.SignalHistory = loadSignalHistory(r.Context(), s.pool, "company", uid, 15)
	resp.Relationships = loadRelationships(r.Context(), s.pool, "company", uid)
	writeJSON(w, resp)
}

func (s *Server) supplierSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	commodity := r.URL.Query().Get("commodity")
	country := r.URL.Query().Get("country")
	rows, err := s.pool.Query(r.Context(), `
		SELECT id, name, country_code, commodities, confidence_score,
		       data_quality_status, evidence_count, contact_count
		FROM supplier_search
		WHERE ($1 = '' OR name ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR $2 = ANY(commodities))
		  AND ($3 = '' OR country_code ILIKE $3)
		ORDER BY confidence_score DESC NULLS LAST, evidence_count DESC, contact_count DESC, name
		LIMIT 30
	`, q, commodity, country)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	var out []SupplierSearchResult
	for rows.Next() {
		var sr SupplierSearchResult
		var id uuid.UUID
		var countryCode *string
		var commodities []string
		_ = rows.Scan(&id, &sr.Name, &countryCode, &commodities, &sr.ConfidenceScore,
			&sr.DataQualityStatus, &sr.EvidenceCount, &sr.ContactCount)
		sr.ID = id.String()
		sr.CountryCode = deref(countryCode)
		sr.Commodities = commodities
		sr.Tier = intelligence.SupplierDiscoveryTier(sr.ConfidenceScore, sr.EvidenceCount)
		sr.RankScore = sr.ConfidenceScore
		out = append(out, sr)
	}
	writeJSON(w, out)
}

func (s *Server) verifyDeal(w http.ResponseWriter, r *http.Request) {
	claims, ok := authClaims(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	tid, _ := uuid.Parse(claims.TenantID)
	uid, _ := uuid.Parse(claims.UserID)
	var input deals.VerifyInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	result, err := s.deals.Verify(r.Context(), &tid, input)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = s.ent.RecordUsage(r.Context(), &tid, &uid, featureDealVerification, 1)
	writeJSON(w, result)
}

func (s *Server) getDeal(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	result, err := s.deals.Get(r.Context(), id)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	writeJSON(w, result)
}

func (s *Server) dealPack(w http.ResponseWriter, r *http.Request) {
	claims, ok := authClaims(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	tid, _ := uuid.Parse(claims.TenantID)
	uid, _ := uuid.Parse(claims.UserID)
	id := chi.URLParam(r, "id")
	format := r.URL.Query().Get("format")
	pack, contentType, err := s.deals.ExportPack(r.Context(), id, format)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	ext := "json"
	if format == "markdown" || format == "md" {
		ext = "md"
	} else if format == "html" {
		ext = "html"
	}
	w.Header().Set("Content-Type", contentType)
	short := id
	if len(short) > 8 {
		short = short[:8]
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=madsan-deal-pack-%s.%s", short, ext))
	_, _ = w.Write(pack)
	_ = s.ent.RecordUsage(r.Context(), &tid, &uid, featureDealPackExport, 1)
}

func (s *Server) watchDeal(w http.ResponseWriter, r *http.Request) {
	claims, ok := authClaims(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id := chi.URLParam(r, "id")
	uid, _ := uuid.Parse(claims.UserID)
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO deal_watch_subscriptions (deal_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING
	`, id, uid)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "watching"})
}

func (s *Server) unwatchDeal(w http.ResponseWriter, r *http.Request) {
	claims, ok := authClaims(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id := chi.URLParam(r, "id")
	uid, _ := uuid.Parse(claims.UserID)
	_, err := s.pool.Exec(r.Context(), `
		DELETE FROM deal_watch_subscriptions WHERE deal_id = $1 AND user_id = $2
	`, id, uid)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "unwatched"})
}

func (s *Server) dealChanges(w http.ResponseWriter, r *http.Request) {
	claims, ok := authClaims(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id := chi.URLParam(r, "id")
	uid, _ := uuid.Parse(claims.UserID)
	resp := deals.ChangesScaffold(id)
	var watching bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM deal_watch_subscriptions WHERE deal_id = $1 AND user_id = $2
		)
	`, id, uid).Scan(&watching)
	resp["watching"] = watching
	writeJSON(w, resp)
}

func (s *Server) metalsLicenseSummary(w http.ResponseWriter, r *http.Request) {
	var mines, plants, countries int
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COUNT(*)::int FROM assets
		WHERE `+assets.MetalsLicenseWhereSQL+` AND asset_type = 'mine'
	`).Scan(&mines)
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COUNT(*)::int FROM assets
		WHERE `+assets.MetalsLicenseWhereSQL+` AND asset_type IN ('processing_plant','smelter')
	`).Scan(&plants)
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COUNT(DISTINCT country_code)::int FROM assets
		WHERE `+assets.MetalsLicenseWhereSQL+`
		  AND asset_type IN ('mine','processing_plant','smelter')
		  AND country_code IS NOT NULL
	`).Scan(&countries)

	rows, _ := s.pool.Query(r.Context(), `
		SELECT COALESCE(country_code,'—') AS country, COUNT(*)::int AS mines
		FROM assets
		WHERE `+assets.MetalsLicenseWhereSQL+` AND asset_type = 'mine'
		GROUP BY country_code ORDER BY mines DESC LIMIT 12
	`)
	var top []map[string]any
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var country string
			var n int
			if rows.Scan(&country, &n) == nil {
				top = append(top, map[string]any{"country": country, "mines": n})
			}
		}
	}
	writeJSON(w, map[string]any{
		"mines": mines, "processing_plants": plants, "countries": countries,
		"top_countries": top,
		"source":        "madsan_db.assets (legacy licenses ETL)",
	})
}

func (s *Server) listIngestionJobs(w http.ResponseWriter, r *http.Request) {
	out, err := s.ingest.ListRecentJobs(r.Context(), 100)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, out)
}

func (s *Server) listReviewQueue(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT id, entity_type, reason, confidence_score, status, created_at,
		       candidate_matches, raw_payload
		FROM manual_review_queue WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var entityType, reason, status string
		var conf *float64
		var created any
		var candidates, raw []byte
		_ = rows.Scan(&id, &entityType, &reason, &conf, &status, &created, &candidates, &raw)
		item := map[string]any{
			"id": id.String(), "entity_type": entityType, "reason": reason,
			"confidence_score": conf, "status": status, "created_at": created,
		}
		if len(candidates) > 0 {
			var c any
			if json.Unmarshal(candidates, &c) == nil {
				item["candidate_matches"] = c
			}
		}
		if len(raw) > 0 {
			var p any
			if json.Unmarshal(raw, &p) == nil {
				item["raw_payload"] = p
			}
		}
		out = append(out, item)
	}
	writeJSON(w, out)
}

func queryInt(r *http.Request, key string, def int) int {
	if v := r.URL.Query().Get(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func queryFloat(r *http.Request, key string) *float64 {
	v := r.URL.Query().Get(key)
	if v == "" {
		return nil
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return nil
	}
	return &f
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
