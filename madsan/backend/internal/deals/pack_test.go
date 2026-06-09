package deals

import "testing"

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
