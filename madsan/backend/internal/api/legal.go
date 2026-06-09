package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/madsan/intelligence/internal/confidence"
)

var legalDisputeRequestTypes = map[string]string{
	"correction": "legal_correction_request",
	"dispute":    "legal_dispute_request",
	"appeal":     "legal_appeal_request",
}

// submitLegalDispute enqueues corrections, disputes, and appeals to manual_review_queue.
func (s *Server) submitLegalDispute(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RequestType     string `json:"request_type"`
		EntityType      string `json:"entity_type"`
		EntityID        string `json:"entity_id"`
		DealID          string `json:"deal_id"`
		FieldInQuestion string `json:"field_in_question"`
		Description     string `json:"description"`
		EvidenceURL     string `json:"evidence_url"`
		ContactEmail    string `json:"contact_email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	requestType := strings.TrimSpace(body.RequestType)
	if requestType == "" {
		requestType = "correction"
	}
	reason, ok := legalDisputeRequestTypes[requestType]
	if !ok {
		http.Error(w, "request_type must be correction, dispute, or appeal", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(body.Description) == "" {
		http.Error(w, "description required", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(body.ContactEmail) == "" {
		http.Error(w, "contact_email required", http.StatusBadRequest)
		return
	}

	var userID *string
	if claims, err := s.auth.ParseRequest(r); err == nil && claims.UserID != "" {
		uid := claims.UserID
		userID = &uid
	}

	payload := map[string]any{
		"request_type":      requestType,
		"entity_type":       strings.TrimSpace(body.EntityType),
		"entity_id":         strings.TrimSpace(body.EntityID),
		"deal_id":           strings.TrimSpace(body.DealID),
		"field_in_question": strings.TrimSpace(body.FieldInQuestion),
		"description":       strings.TrimSpace(body.Description),
		"evidence_url":      strings.TrimSpace(body.EvidenceURL),
		"contact_email":     strings.TrimSpace(body.ContactEmail),
	}
	if userID != nil {
		payload["user_id"] = *userID
	}
	raw, _ := json.Marshal(payload)

	score := confidence.Score(12, nil)
	var queueID string
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO manual_review_queue (entity_type, reason, confidence_score, raw_payload, status)
		VALUES ($1,$2,$3,$4,'pending')
		RETURNING id::text
	`, "legal_dispute", reason, score, raw).Scan(&queueID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]string{
		"status":     "queued",
		"queue_id":   queueID,
		"confidence": "low — feeds analyst review queue",
	})
}

// submitGDPRErasure enqueues GDPR erasure requests to manual_review_queue.
func (s *Server) submitGDPRErasure(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RequestType  string `json:"request_type"`
		ContactEmail string `json:"contact_email"`
		AccountEmail string `json:"account_email"`
		Scope        string `json:"scope"`
		Notes        string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	requestType := strings.TrimSpace(body.RequestType)
	if requestType == "" {
		requestType = "erasure"
	}
	if requestType != "erasure" {
		http.Error(w, "request_type must be erasure", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(body.ContactEmail) == "" {
		http.Error(w, "contact_email required", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(body.Scope) == "" {
		http.Error(w, "scope required", http.StatusBadRequest)
		return
	}

	var userID *string
	if claims, err := s.auth.ParseRequest(r); err == nil && claims.UserID != "" {
		uid := claims.UserID
		userID = &uid
	}

	payload := map[string]any{
		"request_type":  requestType,
		"contact_email": strings.TrimSpace(body.ContactEmail),
		"account_email": strings.TrimSpace(body.AccountEmail),
		"scope":         strings.TrimSpace(body.Scope),
		"notes":         strings.TrimSpace(body.Notes),
	}
	if userID != nil {
		payload["user_id"] = *userID
	}
	raw, _ := json.Marshal(payload)

	score := confidence.Score(12, nil)
	var queueID string
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO manual_review_queue (entity_type, reason, confidence_score, raw_payload, status)
		VALUES ($1,$2,$3,$4,'pending')
		RETURNING id::text
	`, "gdpr_erasure_request", "gdpr_erasure_request", score, raw).Scan(&queueID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]string{
		"status":     "queued",
		"queue_id":   queueID,
		"confidence": "low — feeds analyst review queue",
	})
}
