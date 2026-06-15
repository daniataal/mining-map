package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/madsan/intelligence/internal/confidence"
)

// submitProductFeedback enqueues in-product data/deal feedback to manual_review_queue.
func (s *Server) submitProductFeedback(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FeedbackKind string `json:"feedback_kind"`
		EntityType   string `json:"entity_type"`
		EntityID     string `json:"entity_id"`
		EntityName   string `json:"entity_name"`
		DealID       string `json:"deal_id"`
		Verdict      string `json:"verdict"`
		Notes        string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	kind := strings.TrimSpace(body.FeedbackKind)
	verdict := strings.TrimSpace(body.Verdict)
	if kind == "" {
		http.Error(w, "feedback_kind required (data_feedback or deal_feedback)", http.StatusBadRequest)
		return
	}
	if kind != "data_feedback" && kind != "deal_feedback" {
		http.Error(w, "feedback_kind must be data_feedback or deal_feedback", http.StatusBadRequest)
		return
	}

	var reason string
	switch kind {
	case "data_feedback":
		if verdict == "" {
			verdict = "inaccurate"
		}
		if verdict != "inaccurate" {
			http.Error(w, "data_feedback verdict must be inaccurate", http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(body.EntityType) == "" && strings.TrimSpace(body.EntityName) == "" {
			http.Error(w, "entity_type or entity_name required for data_feedback", http.StatusBadRequest)
			return
		}
		reason = "user_flagged_inaccurate_data"
	case "deal_feedback":
		if verdict != "real" && verdict != "scam" {
			http.Error(w, "deal_feedback verdict must be real or scam", http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(body.DealID) == "" {
			http.Error(w, "deal_id required for deal_feedback", http.StatusBadRequest)
			return
		}
		if verdict == "real" {
			reason = "user_reported_deal_real"
		} else {
			reason = "user_reported_deal_scam"
		}
	}

	var userID *string
	if claims, err := s.auth.ParseRequest(r); err == nil && claims.UserID != "" {
		uid := claims.UserID
		userID = &uid
	}

	payload := map[string]any{
		"feedback_kind": kind,
		"verdict":       verdict,
		"entity_type":   strings.TrimSpace(body.EntityType),
		"entity_id":     strings.TrimSpace(body.EntityID),
		"entity_name":   strings.TrimSpace(body.EntityName),
		"deal_id":       strings.TrimSpace(body.DealID),
		"notes":         strings.TrimSpace(body.Notes),
	}
	if userID != nil {
		payload["user_id"] = *userID
	}
	raw, _ := json.Marshal(payload)

	score := confidence.Score(12, nil)
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO manual_review_queue (entity_type, reason, confidence_score, raw_payload, status)
		VALUES ($1,$2,$3,$4,'pending')
	`, kind, reason, score, raw)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if userID != nil && strings.TrimSpace(body.EntityID) != "" {
		feedbackVerdict := verdict
		if kind == "data_feedback" {
			feedbackVerdict = "data_quality"
		}
		_, _ = s.pool.Exec(r.Context(), `
			INSERT INTO feedback_events (user_id, entity_type, entity_id, verdict, notes)
			VALUES ($1::uuid, $2, NULLIF($3,'')::uuid, $4, $5)
		`, *userID, kind, strings.TrimSpace(body.EntityID), feedbackVerdict, strings.TrimSpace(body.Notes))
	}

	writeJSON(w, map[string]string{
		"status":     "queued",
		"confidence": "low — feeds analyst review queue",
	})
}
