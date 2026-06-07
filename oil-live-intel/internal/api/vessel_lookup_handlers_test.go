package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSearchVesselsRequiresQuery(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/vessels/search", nil)
	w := httptest.NewRecorder()

	s.SearchVessels(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestSearchVesselsNoPool(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/vessels/search?q=aram", nil)
	w := httptest.NewRecorder()

	s.SearchVessels(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
}
