package deals

import (
	"strings"
	"testing"
)

func TestExtractJSONStripsMarkdownFence(t *testing.T) {
	raw := "```json\n{\"summary\":\"ok\"}\n```"
	got := extractJSON(raw)
	if !strings.Contains(got, `"summary":"ok"`) {
		t.Fatalf("extractJSON() = %q", got)
	}
}

func TestBuildDDGroundingIncludesEvidenceFields(t *testing.T) {
	pack := map[string]any{
		"deal_id": "abc",
		"sections": map[string]any{
			"dd_checks":            []any{"kyc"},
			"sanctions_screening":  map[string]any{"seller": "clear"},
			"red_flags":            []any{"missing_loi"},
			"positive_evidence":    []any{"terminal_match"},
			"missing_documents":    []any{"q88"},
			"recommended_questions": []any{"who operates tank?"},
		},
	}
	got := buildDDGrounding(pack)
	for _, needle := range []string{"dd_checks", "sanctions_screening", "red_flags", "positive_evidence"} {
		if !strings.Contains(got, needle) {
			t.Fatalf("grounding missing %q: %s", needle, got)
		}
	}
}
