package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLicenseMapClustersInvalidBBox(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/licenses/map?min_lat=1&max_lat=0", nil)
	w := httptest.NewRecorder()
	s.LicenseMapClusters(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d", w.Code)
	}
}

func TestLicenseMapClustersPointsFallback(t *testing.T) {
	s := &Server{Pool: nil}
	req := httptest.NewRequest(http.MethodGet,
		"/api/oil-live/licenses/map?min_lat=-10&max_lat=10&min_lng=-10&max_lng=10&zoom=8", nil)
	w := httptest.NewRecorder()
	s.LicenseMapClusters(w, req)
	if w.Code != http.StatusNotImplemented {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["mode"] != "points" || body["fallback"] != "python" {
		t.Fatalf("unexpected: %v", body)
	}
}

func TestLicenseMapClustersNoDB(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet,
		"/api/oil-live/licenses/map?min_lat=-10&max_lat=10&min_lng=-10&max_lng=10&zoom=4", nil)
	w := httptest.NewRecorder()
	s.LicenseMapClusters(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d", w.Code)
	}
}
