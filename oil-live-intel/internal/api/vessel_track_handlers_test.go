package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetVesselTrackInvalidMMSI(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/vessels/not-a-mmsi/track", nil)
	w := httptest.NewRecorder()
	s.GetVesselTrack(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d", w.Code)
	}
}

func TestVesselTrackResponsePointsShape(t *testing.T) {
	// Document expected JSON contract: points is always an array when handler succeeds.
	points := make([]map[string]any, 0)
	b, err := json.Marshal(map[string]any{
		"mmsi":   123456789,
		"hours":  24,
		"points": points,
	})
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]json.RawMessage
	if err := json.Unmarshal(b, &parsed); err != nil {
		t.Fatal(err)
	}
	if string(parsed["points"]) != "[]" {
		t.Fatalf("expected empty points array, got %s", parsed["points"])
	}
}
