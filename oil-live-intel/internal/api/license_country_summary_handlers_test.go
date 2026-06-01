package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLicenseCountrySummaryInvalidBBox(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/licenses/country-summary?min_lat=1&max_lat=0", nil)
	w := httptest.NewRecorder()
	s.LicenseCountrySummary(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d", w.Code)
	}
}

func TestLicenseCountrySummaryNoDB(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet,
		"/api/oil-live/licenses/country-summary?min_lat=-10&max_lat=10&min_lng=-10&max_lng=10", nil)
	w := httptest.NewRecorder()
	s.LicenseCountrySummary(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d", w.Code)
	}
}
