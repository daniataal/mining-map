package deals

import "testing"

func TestPackToMarkdownGold(t *testing.T) {
	pack := map[string]any{
		"vertical":     "metals",
		"deal_id":      "gold-1",
		"title":        "Gold deal — Dubai",
		"generated_at": "2026-06-10T12:00:00Z",
		"deal_summary": map[string]any{
			"commodity": "Gold (AU)",
			"quantity":  "500.00",
			"location":  "Dubai, UAE",
		},
		"price_context": map[string]any{
			"benchmark_symbol": "GOLD",
			"benchmark_label":  "Gold spot",
			"benchmark_price":  2348.5,
			"benchmark_unit":   "/oz",
			"benchmark_tier":   "reference_stub",
			"comparable":       true,
			"claimed_price":    68500.0,
			"claimed_currency": "USD",
			"delta_pct":        2815.0,
		},
		"parties": []partyProfile{{
			Role: "seller", Name: "Sample Refinery DMCC", Country: "AE", Confidence: 62,
		}},
		"sections": map[string]any{
			"confidence_score":  62.0,
			"confidence_status": "partial",
			"dd_recommendation": "review",
			"missing_documents": []any{"LBMA good delivery certificate", "Assay certificate (accredited lab)"},
		},
		"limitations": []any{"Intelligence only"},
		"disclaimer":  "Metals intelligence pack.",
	}
	md := PackToMarkdown(pack)
	for _, want := range []string{
		"MadSan Metals Deal Due Diligence Pack",
		"Gold (AU)",
		"Price context",
		"LBMA good delivery certificate",
		"Sample Refinery DMCC",
	} {
		if !contains(md, want) {
			t.Fatalf("markdown missing %q:\n%s", want, md)
		}
	}
}

func TestPackToMarkdown(t *testing.T) {
	pack := map[string]any{
		"deal_id":      "abc-123",
		"title":        "VLSFO deal — Fujairah",
		"generated_at": "2026-06-09T12:00:00Z",
		"deal_summary": map[string]any{
			"commodity": "VLSFO",
			"quantity":  5000.0,
			"location":  "Fujairah",
		},
		"parties": []partyProfile{{
			Role: "seller", Name: "Test Bunker Co", Country: "AE", Confidence: 75,
			Evidence: []partyEvidence{{ClaimType: "phone", Source: "Bunker fuel suppliers seed", Tier: "observed"}},
		}},
		"sections": map[string]any{
			"confidence_score":  75.0,
			"confidence_status": "partial",
			"dd_recommendation": "review",
			"red_flags":         []any{},
			"warnings":          []any{"OpenSanctions review-tier match for seller"},
			"missing_documents": []any{"Tank storage receipt"},
		},
		"limitations": []any{"Intelligence only"},
		"disclaimer":  "Not legal advice.",
	}
	md := PackToMarkdown(pack)
	for _, want := range []string{"MadSan Deal Due Diligence Pack", "VLSFO", "Test Bunker Co", "review", "Tank storage receipt"} {
		if !contains(md, want) {
			t.Fatalf("markdown missing %q:\n%s", want, md)
		}
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
