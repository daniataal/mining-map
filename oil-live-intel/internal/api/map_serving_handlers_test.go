package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/mining-map/oil-live-intel/internal/config"
)

func TestGetMapFeaturePopupMissingKey(t *testing.T) {
	s := &Server{Config: config.Config{}}
	r := chi.NewRouter()
	r.Get("/map/features/{feature_key}/popup", s.GetMapFeaturePopup)

	req := httptest.NewRequest(http.MethodGet, "/map/features/%20/popup", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
