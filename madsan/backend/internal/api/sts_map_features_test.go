package api

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestStsEventKind(t *testing.T) {
	if got := stsEventKind(map[string]any{"source": "legacy_import"}); got != "historic" {
		t.Fatalf("want historic, got %q", got)
	}
	if got := stsEventKind(map[string]any{"detector": "ais_proximity_v1"}); got != "inferred" {
		t.Fatalf("want inferred, got %q", got)
	}
}

func TestStsProductHint(t *testing.T) {
	if got := stsProductHint("crude", "crude"); got == "" {
		t.Fatal("expected crude hint")
	}
	if got := stsProductHint("product", "product"); got == "" {
		t.Fatal("expected product hint")
	}
}

func TestStsFeatureProperties(t *testing.T) {
	id := uuid.New()
	props := stsFeatureProperties(id, map[string]any{
		"mmsi_a": "111", "mmsi_b": "222",
		"start_ts": "2024-01-01T00:00:00Z", "end_ts": "2024-01-01T02:00:00Z",
		"zone_name": "Malta STS", "min_distance_m": 120.0,
	}, 72, time.Now(), "observed", "ALPHA", "BRAVO", "crude", "product")
	if props["event_kind"] != "inferred" {
		t.Fatalf("event_kind=%v", props["event_kind"])
	}
	if props["name"] != "ALPHA ↔ BRAVO" {
		t.Fatalf("name=%v", props["name"])
	}
	if props["product_hint"] == "" {
		t.Fatal("expected product hint")
	}
}
