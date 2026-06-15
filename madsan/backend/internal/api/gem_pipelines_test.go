package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNearestGemPipelineRouteRegistered(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/energy/pipelines/nearest-gem?lat=31.5&lng=34.8", nil)
	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, req)
	if rr.Code == http.StatusNotFound {
		t.Fatal("nearest-gem pipeline route not registered")
	}
}

func TestNearestGemPipelineBadCoords(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/energy/pipelines/nearest-gem", nil)
	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}
