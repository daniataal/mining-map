package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSanctionsCountrySummaryRequiresDatabase(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/sanctions/country-summary", nil)
	w := httptest.NewRecorder()
	s.SanctionsCountrySummary(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d", w.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "database_unavailable" {
		t.Fatalf("unexpected body: %v", body)
	}
}
