package confidence

import "testing"

func TestScorePortCall_Clamp(t *testing.T) {
	got := ScorePortCall(Input{
		InsideTerminal:          true,
		DurationHours:           24,
		DraftDeltaAbs:           2,
		KnownTanker:             true,
		DestinationKnown:        true,
		MatchingProductTerminal: true,
	})
	if got > 1 || got < 0 {
		t.Fatalf("expected clamped 0-1, got %v", got)
	}
	if got < 0.8 {
		t.Fatalf("expected high confidence, got %v", got)
	}
}

func TestScorePortCall_ShortStayPenalty(t *testing.T) {
	high := ScorePortCall(Input{InsideTerminal: true, DurationHours: 20, DraftDeltaAbs: 2, KnownTanker: true})
	low := ScorePortCall(Input{InsideTerminal: true, DurationHours: 2, DraftDeltaAbs: 2, KnownTanker: true})
	if low >= high {
		t.Fatalf("short stay should reduce score: high=%v low=%v", high, low)
	}
}
