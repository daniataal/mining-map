package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/madsan/intelligence/internal/config"
)

func TestEnrichmentRefreshRouteRegistered(t *testing.T) {
	srv := &Server{cfg: config.Config{}}
	handler := srv.Router()

	req := httptest.NewRequest(http.MethodPost, "/api/core/entities/vessel/00000000-0000-0000-0000-000000000001/enrichment/refresh", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code == http.StatusNotFound {
		t.Fatal("enrichment refresh route not registered")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without auth, got %d", rec.Code)
	}
}
