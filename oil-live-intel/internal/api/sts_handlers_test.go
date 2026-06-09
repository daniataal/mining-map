package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/mining-map/oil-live-intel/internal/config"
)

func TestListSTSEvents_NoDatabase(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/sts-events", nil)
	w := httptest.NewRecorder()
	s.ListSTSEvents(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d", w.Code)
	}
}

func TestGetSTSEventsSummary_NoDatabase(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/sts-events/summary", nil)
	w := httptest.NewRecorder()
	s.GetSTSEventsSummary(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d", w.Code)
	}
}

func TestGetSTSEventsSummary_InvalidBBox(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/sts-events/summary?bbox=bad", nil)
	w := httptest.NewRecorder()
	s.GetSTSEventsSummary(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
}

func TestGetSTSEventsSummary_InvalidFrom(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/sts-events/summary?from=not-a-time", nil)
	w := httptest.NewRecorder()
	s.GetSTSEventsSummary(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
}

func TestGetSTSEvent_InvalidID(t *testing.T) {
	s := &Server{}
	req := withSTSIDParam(httptest.NewRequest(http.MethodGet, "/api/oil-live/sts-events/not-a-uuid", nil), "not-a-uuid")
	w := httptest.NewRecorder()
	s.GetSTSEvent(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
}

func TestGetSTSEvent_NoDatabase(t *testing.T) {
	s := &Server{}
	req := withSTSIDParam(
		httptest.NewRequest(http.MethodGet, "/api/oil-live/sts-events/00000000-0000-0000-0000-000000000001", nil),
		"00000000-0000-0000-0000-000000000001",
	)
	w := httptest.NewRecorder()
	s.GetSTSEvent(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
}

func TestSTSEmptyTierCounts(t *testing.T) {
	counts := stsEmptyTierCounts()
	for _, tier := range []string{"low", "medium", "high", "very_high", "verified"} {
		if _, ok := counts[tier]; !ok {
			t.Fatalf("missing tier %q in %#v", tier, counts)
		}
	}
}

func TestSTSLastScanHint(t *testing.T) {
	if stsLastScanHint(nil) == "" {
		t.Fatal("expected hint for nil scan")
	}
	ts := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)
	if got := stsLastScanHint(&ts); got != "2026-06-06T12:00:00Z" {
		t.Fatalf("got %q", got)
	}
}

func TestGetVesselSTSHistory_InvalidMMSI(t *testing.T) {
	s := &Server{}
	req := withMMSIParam(httptest.NewRequest(http.MethodGet, "/api/oil-live/vessels/bad/sts-history", nil), "bad")
	w := httptest.NewRecorder()
	s.GetVesselSTSHistory(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
}

func TestGetVesselSTSHistory_NoDatabase(t *testing.T) {
	s := &Server{}
	req := withMMSIParam(httptest.NewRequest(http.MethodGet, "/api/oil-live/vessels/123456789/sts-history", nil), "123456789")
	w := httptest.NewRecorder()
	s.GetVesselSTSHistory(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d", w.Code)
	}
}

func TestParseTimeRange_Defaults(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/sts-events", nil)
	from, to, err := parseTimeRange(req, 72*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if !to.After(from) {
		t.Fatalf("from=%v to=%v", from, to)
	}
}

func TestParseTimeRange_InvalidFrom(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/sts-events?from=not-a-time", nil)
	_, _, err := parseTimeRange(req, time.Hour)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestSTSResponseDisclaimerShape(t *testing.T) {
	b, err := json.Marshal(map[string]any{"disclaimer": stsResponseDisclaimer})
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(b, &parsed); err != nil {
		t.Fatal(err)
	}
	d, ok := parsed["disclaimer"].(map[string]any)
	if !ok || d["inference_only"] != true {
		t.Fatalf("unexpected disclaimer %#v", parsed["disclaimer"])
	}
}

func withMMSIParam(req *http.Request, mmsi string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("mmsi", mmsi)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func withSTSIDParam(req *http.Request, id string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestPatchSTSEvent_Unauthorized(t *testing.T) {
	s := &Server{Config: config.Config{STSAnalystToken: "secret"}}
	req := withSTSIDParam(httptest.NewRequest(http.MethodPatch, "/api/oil-live/sts-events/00000000-0000-0000-0000-000000000001", nil), "00000000-0000-0000-0000-000000000001")
	w := httptest.NewRecorder()
	s.PatchSTSEvent(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status %d", w.Code)
	}
}

func TestPatchSTSEvent_NoDatabase(t *testing.T) {
	s := &Server{Config: config.Config{STSAnalystToken: "secret"}}
	req := withSTSIDParam(httptest.NewRequest(http.MethodPatch, "/api/oil-live/sts-events/00000000-0000-0000-0000-000000000001", strings.NewReader(`{}`)), "00000000-0000-0000-0000-000000000001")
	req.Header.Set("X-Analyst-Token", "secret")
	w := httptest.NewRecorder()
	s.PatchSTSEvent(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
}

func TestPatchSTSEvent_InvalidStatus(t *testing.T) {
	s := &Server{Config: config.Config{STSAnalystToken: "secret"}}
	body := strings.NewReader(`{"status":"inferred"}`)
	req := withSTSIDParam(httptest.NewRequest(http.MethodPatch, "/api/oil-live/sts-events/00000000-0000-0000-0000-000000000001", body), "00000000-0000-0000-0000-000000000001")
	req.Header.Set("X-Analyst-Token", "secret")
	w := httptest.NewRecorder()
	s.PatchSTSEvent(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
}
