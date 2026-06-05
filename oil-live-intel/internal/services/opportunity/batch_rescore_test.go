package opportunity

import "testing"

func TestBatchRescoreScoreDeal(t *testing.T) {
	in := DealScoreInput{
		MovementActivity:    0.8,
		InfrastructureFit:   0.4,
		CounterpartyClarity: 0.7,
		MacroSupport:        0.5,
		RouteReadiness:      0.5,
		Provenance:          0.6,
	}
	score := ScoreDeal(in)
	if score < 0.5 || score > 1 {
		t.Fatalf("unexpected score %v", score)
	}
}
