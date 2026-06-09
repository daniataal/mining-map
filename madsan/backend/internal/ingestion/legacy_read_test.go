package ingestion

import (
	"encoding/json"
	"testing"
	"time"
)

func TestNormalizeLegacyLicenseRow(t *testing.T) {
	rec := normalizeLegacyRow(legacyTableSpec{Table: "licenses", EntityType: "asset", AssetType: "mine"}, map[string]any{
		"id": 42, "company": "Acme Mining", "country": "zm", "commodity": "copper",
		"sector": "mining", "latitude": -12.5, "longitude": 28.3, "geo_confidence": 0.8,
	})
	if rec.Name != "Acme Mining" || rec.AssetType != "mine" || rec.CountryCode != "ZM" {
		t.Fatalf("unexpected: %+v", rec)
	}
	if len(rec.Commodities) != 1 || rec.Commodities[0] != "copper" {
		t.Fatalf("commodities: %v", rec.Commodities)
	}
}

func TestFilterLegacyTables(t *testing.T) {
	out := filterLegacyTables([]string{"oil_vessels"})
	if len(out) != 1 || out[0].Table != "oil_vessels" {
		t.Fatalf("filter failed: %+v", out)
	}
}

func TestBuildLegacyImportReport(t *testing.T) {
	started := time.Now().Add(-1500 * time.Millisecond)
	report := buildLegacyImportReport(map[string]any{
		"imported": 42,
		"tables":   []string{"oil_vessels"},
	}, started)
	var m map[string]any
	if json.Unmarshal(report, &m) != nil {
		t.Fatal("invalid json")
	}
	if m["imported"] != float64(42) {
		t.Fatalf("imported: %v", m["imported"])
	}
	dur, ok := m["duration_ms"].(float64)
	if !ok || dur < 1000 {
		t.Fatalf("expected duration_ms >= 1000, got %v", m["duration_ms"])
	}
	if m["completed_at"] == nil {
		t.Fatal("expected completed_at")
	}
}

func TestDryRunFromPayload(t *testing.T) {
	if dryRunFromPayload(nil) {
		t.Fatal("nil payload should not be dry run")
	}
	payload, _ := json.Marshal(map[string]any{"dry_run": true})
	if !dryRunFromPayload(payload) {
		t.Fatal("expected dry_run true from payload")
	}
	payload2, _ := json.Marshal(map[string]any{"dry_run": false})
	if dryRunFromPayload(payload2) {
		t.Fatal("expected dry_run false")
	}
}
