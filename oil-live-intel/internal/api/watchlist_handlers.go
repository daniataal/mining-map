package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/mining-map/oil-live-intel/internal/services/alerts"
	"github.com/mining-map/oil-live-intel/internal/services/watchlist"
)

func (s *Server) ListWatchlists(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	items, err := watchlist.List(r.Context(), s.Pool, userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"watchlists": items})
}

func (s *Server) AddWatchlist(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID        string  `json:"user_id"`
		WatchType     string  `json:"watch_type"`
		WatchRef      string  `json:"watch_ref"`
		Label         string  `json:"label"`
		MinConfidence float64 `json:"min_confidence"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	item, err := watchlist.Add(r.Context(), s.Pool, body.UserID, body.WatchType, body.WatchRef, body.Label, body.MinConfidence)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"watchlist": item})
}

func (s *Server) DeleteWatchlist(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := r.URL.Query().Get("user_id")
	if err := watchlist.Remove(r.Context(), s.Pool, userID, id); err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) ListAlerts(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	unread := r.URL.Query().Get("unread_only") == "true"
	limit := queryInt(r, "limit", 50)
	items, err := alerts.List(r.Context(), s.Pool, userID, unread, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"alerts": items})
}

func (s *Server) MarkAlertRead(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := r.URL.Query().Get("user_id")
	if err := alerts.MarkRead(r.Context(), s.Pool, userID, id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "read"})
}

func (s *Server) MarkAllAlertsRead(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID string `json:"user_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	userID := body.UserID
	if userID == "" {
		userID = r.URL.Query().Get("user_id")
	}
	n, err := alerts.MarkAllRead(r.Context(), s.Pool, userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"marked": n})
}

func (s *Server) AssignAlert(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		UserID   string `json:"user_id"`
		Assignee string `json:"assignee"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Assignee == "" {
		writeErr(w, http.StatusBadRequest, "assignee required")
		return
	}
	if err := alerts.Assign(r.Context(), s.Pool, body.UserID, id, body.Assignee); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "assigned"})
}
