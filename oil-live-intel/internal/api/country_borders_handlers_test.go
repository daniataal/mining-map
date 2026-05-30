package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNormalizeCountryName(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"Côte d'Ivoire", "cote d ivoire"},
		{"Congo, Kinshasa", "democratic republic of the congo"},
		{"RUSSIA", "russian federation"},
		{"Trinidad & Tobago", "trinidad and tobago"},
		{"  USA  ", "united states of america"},
	}

	for _, c := range cases {
		if got := normalizeCountryName(c.in); got != c.want {
			t.Errorf("normalizeCountryName(%q) == %q, want %q", c.in, got, c.want)
		}
	}
}

func TestCountryBordersHandler(t *testing.T) {
	// We won't test the full 45MB file content parsing exactly, but we can verify
	// the handler doesn't panic and returns a valid GeoJSON response.
	s := &Server{}

	req := httptest.NewRequest("GET", "/api/oil-live/map/country-borders?countries=russia,uae", nil)
	rr := httptest.NewRecorder()

	s.CountryBorders(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var resp GeoJSONFeatureCollection
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}

	if resp.Type != "FeatureCollection" {
		t.Errorf("expected FeatureCollection, got %s", resp.Type)
	}

	etag := rr.Header().Get("ETag")
	if etag == "" {
		t.Errorf("expected ETag header")
	}

	// Test If-None-Match
	req2 := httptest.NewRequest("GET", "/api/oil-live/map/country-borders?countries=russia,uae", nil)
	req2.Header.Set("If-None-Match", etag)
	rr2 := httptest.NewRecorder()

	s.CountryBorders(rr2, req2)

	if rr2.Code != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", rr2.Code)
	}
}
