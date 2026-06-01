package api

import (
	"net/http"
	"time"
)

// SyncStatus reports DB coverage counts and last graph-sync timestamp.
func (s *Server) SyncStatus(w http.ResponseWriter, r *http.Request) {
	out := querySyncStatus(r.Context(), s.Pool)
	writeJSON(w, http.StatusOK, out)
}

func formatTimePtr(t *time.Time) any {
	if t == nil || t.IsZero() {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}
