package leads

import (
	"strings"
	"testing"
)

func TestLeadRankScore(t *testing.T) {
	got := LeadRankScore(10, 3, 70)
	if got != 59 {
		t.Fatalf("rank=%v want 59", got)
	}
	if LeadRankScore(0, 0, 0) != 0 {
		t.Fatal("expected zero rank for empty gap")
	}
}

func TestTradeFlowGapDetail(t *testing.T) {
	withHints := tradeFlowGapDetail("SG", "vlsfo", 12, 2)
	if withHints == "" || !strings.Contains(withHints, "operator name hints") {
		t.Fatalf("detail=%q", withHints)
	}
	noHints := tradeFlowGapDetail("AE", "crude", 5, 0)
	if !strings.Contains(noHints, "no mapped supplier") {
		t.Fatalf("detail=%q", noHints)
	}
}
