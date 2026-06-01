package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCoverageQuality(t *testing.T) {
	cases := []struct {
		vessels int
		want    string
	}{
		{0, "gap"},
		{1, "sparse"},
		{10, "fair"},
		{50, "strong"},
	}
	for _, tc := range cases {
		if got := coverageQuality(tc.vessels); got != tc.want {
			t.Fatalf("vessels=%d: got %q want %q", tc.vessels, got, tc.want)
		}
	}
}

func TestCoverageConfidence(t *testing.T) {
	if coverageConfidence(0) >= coverageConfidence(10) {
		t.Fatal("expected higher vessel count to increase confidence")
	}
	if coverageConfidence(50) <= coverageConfidence(10) {
		t.Fatal("expected strong cell confidence above fair")
	}
}

func TestParseCSVParam(t *testing.T) {
	if got := parseCSVParam(""); got != nil {
		t.Fatalf("empty: %#v", got)
	}
	got := parseCSVParam(" AISStream, aishub ,aisstream ")
	if len(got) != 2 || got[0] != "aisstream" || got[1] != "aishub" {
		t.Fatalf("unexpected: %#v", got)
	}
}

func TestVesselCoverageRequiresBBox(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/coverage", nil)
	w := httptest.NewRecorder()
	s.VesselCoverage(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d", w.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["error"] == nil {
		t.Fatalf("expected error body: %v", body)
	}
}

func TestSourceHealthFallback(t *testing.T) {
	items := fallbackSourceHealth()
	if len(items) < 2 {
		t.Fatalf("expected fallback sources, got %d", len(items))
	}
	first, _ := items[0]["source"].(string)
	if first != "aisstream" {
		t.Fatalf("unexpected first source %q", first)
	}
}
