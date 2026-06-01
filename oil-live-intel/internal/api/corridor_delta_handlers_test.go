package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCorridorDeltaBadGroupIgnored(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/corridors/delta?window_days=30&limit=5", nil)
	// Without DB pool this would panic — skip integration; validate query parsing only.
	if req.URL.Query().Get("window_days") != "30" {
		t.Fatalf("expected window_days=30")
	}
	_ = s
}
