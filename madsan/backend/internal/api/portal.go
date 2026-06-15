package api

import (
	"encoding/json"
	"net/http"

	"github.com/madsan/intelligence/internal/confidence"
)

func (s *Server) submitSupplierOffer(w http.ResponseWriter, r *http.Request) {
	claims, ok := authClaims(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body struct {
		Commodity   string  `json:"commodity"`
		Quantity    float64 `json:"quantity"`
		Location    string  `json:"location"`
		CompanyName string  `json:"company_name"`
		Notes       string  `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	score := confidence.Score(15, nil)
	payload, _ := json.Marshal(body)
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO supplier_submissions (submitted_by, company_name, payload, status)
		VALUES ($1,$2,$3,'pending')
	`, claims.UserID, body.CompanyName, payload)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		INSERT INTO manual_review_queue (entity_type, reason, confidence_score, raw_payload, status)
		VALUES ('supplier_offer','supplier_portal_submission',$1,$2,'pending')
	`, score, payload)
	writeJSON(w, map[string]string{"status": "submitted", "confidence": "low — pending analyst review"})
}

func (s *Server) submitFeedback(w http.ResponseWriter, r *http.Request) {
	claims, ok := authClaims(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body struct {
		EntityType string `json:"entity_type"`
		EntityID   string `json:"entity_id"`
		Feedback   string `json:"feedback"`
		IsScam     bool   `json:"is_scam"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	verdict := "data_quality"
	if body.IsScam {
		verdict = "scam_report"
	}
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO feedback_events (user_id, entity_type, entity_id, verdict, notes)
		VALUES ($1,$2,$3,$4,$5)
	`, claims.UserID, body.EntityType, body.EntityID, verdict, body.Feedback)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "recorded"})
}
