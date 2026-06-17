package api

import (
	"strings"
	"testing"

	"github.com/madsan/intelligence/internal/ingestion"
)

func TestBuildFallbackThesisTextIncludesScenarioDisclaimer(t *testing.T) {
	text := buildFallbackThesisText(&opportunityDossierRow{
		OriginCountry:      "SA",
		DestinationCountry: "US",
		Commodity:          "CRUDEOIL",
		Score:              82.5,
	})
	if text == "" {
		t.Fatal("expected thesis text")
	}
	lower := strings.ToLower(text)
	for _, needle := range []string{"sa", "us", "crudeoil", "scenario intelligence", "not investment advice"} {
		if !strings.Contains(lower, needle) {
			t.Fatalf("thesis missing %q: %s", needle, text)
		}
	}
}

func TestBuildOpportunityEvidenceChainOrdering(t *testing.T) {
	chain := buildOpportunityEvidenceChain(
		&opportunityDossierRow{ID: "opp-1", DestinationCountry: "US"},
		map[string]any{"status": "ready", "scenario_label": "scenario_intelligence"},
		[]map[string]any{{"name": "Importer A"}},
		[]map[string]any{{"id": "cargo-1"}},
		nil,
		map[string]any{"status": "indicative_bands"},
	)
	if len(chain) < 4 {
		t.Fatalf("expected >=4 evidence steps, got %d: %#v", len(chain), chain)
	}
	if chain[0]["step"] != "opportunity" {
		t.Fatalf("first step = %v", chain[0]["step"])
	}
}

func TestBrokerAlphaThesisHelper(t *testing.T) {
	text := ingestion.BrokerAlphaThesis("CRUDEOIL", "SA", "US", 80, 55, 2, true)
	lower := strings.ToLower(text)
	if !strings.Contains(lower, "scenario intelligence") || !strings.Contains(lower, "not stock") {
		t.Fatalf("unexpected thesis: %s", text)
	}
}

func TestDedupeImporterRows(t *testing.T) {
	items := dedupeImporterRows([]map[string]any{
		{"company_id": "a", "name": "X", "source": "eia_company_imports"},
		{"company_id": "a", "name": "X", "source": "eia_company_imports"},
		{"company_id": "b", "name": "Y", "source": "eia_company_imports"},
	})
	if len(items) != 2 {
		t.Fatalf("dedupe len = %d", len(items))
	}
}
