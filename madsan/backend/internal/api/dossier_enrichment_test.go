package api

import (
	"testing"
	"time"
)

func TestMergeVesselEnrichmentSummaryShape(t *testing.T) {
	stale := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	fetched := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	dwt := 105000.0
	summary := map[string]any{"mmsi": "273123456"}
	mergeVesselEnrichmentSummary(summary, vesselEnrichmentRow{
		OwnerName:    "Acme Tankers Ltd",
		OperatorName: "Acme Operations",
		Source:       "legacy_shipvault_cache",
		Tier:         "observed",
		Confidence:   72,
		StaleAfter:   &stale,
		FetchedAt:    &fetched,
		DWT:          &dwt,
		VesselClass:  "Aframax",
		Flag:         "PA",
	})

	if summary["owner_name"] != "Acme Tankers Ltd" {
		t.Fatalf("owner_name = %v", summary["owner_name"])
	}
	if summary["operator_name"] != "Acme Operations" {
		t.Fatalf("operator_name = %v", summary["operator_name"])
	}
	enrich, ok := summary["enrichment"].(map[string]any)
	if !ok {
		t.Fatalf("enrichment block missing: %#v", summary["enrichment"])
	}
	for _, key := range []string{"tier", "source", "confidence", "stale_after", "fetched_at", "fresh"} {
		if enrich[key] == nil {
			t.Fatalf("enrichment[%s] missing", key)
		}
	}
	if enrich["tier"] != "observed" {
		t.Fatalf("tier = %v", enrich["tier"])
	}
}

func TestMergeVesselEnrichmentSummaryOmitsEmptyBlock(t *testing.T) {
	summary := map[string]any{"mmsi": "235090927"}
	mergeVesselEnrichmentSummary(summary, vesselEnrichmentRow{})
	if _, ok := summary["enrichment"]; ok {
		t.Fatalf("expected no enrichment block for empty row, got %#v", summary["enrichment"])
	}
}

func TestEnrichmentLimitationsNotImplemented(t *testing.T) {
	lims := enrichmentLimitations(vesselEnrichmentRow{
		Tier:        "not_implemented",
		Limitations: []string{"Equasis not wired"},
	})
	if len(lims) < 2 {
		t.Fatalf("expected not_implemented limitations, got %v", lims)
	}
}
