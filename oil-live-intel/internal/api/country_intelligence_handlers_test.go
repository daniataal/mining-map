package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func withCountryParam(req *http.Request, country string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("country", country)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestCountryIntelligenceMissingCountry(t *testing.T) {
	s := &Server{}
	req := withCountryParam(
		httptest.NewRequest(http.MethodGet, "/api/oil-live/intelligence/country/", nil),
		"   ",
	)
	rec := httptest.NewRecorder()
	s.CountryIntelligence(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", rec.Code)
	}
}

func TestCountryIntelligenceNoDatabase(t *testing.T) {
	s := &Server{Pool: nil}
	req := withCountryParam(
		httptest.NewRequest(http.MethodGet, "/api/oil-live/intelligence/country/Brazil", nil),
		"Brazil",
	)
	rec := httptest.NewRecorder()
	s.CountryIntelligence(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503", rec.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["error"] != "database_unavailable" {
		t.Fatalf("error %q", body["error"])
	}
}
