package opportunity

import "testing"

func TestScoreDealWeightsExecutionSignals(t *testing.T) {
	score := ScoreDeal(DealScoreInput{
		MovementActivity:    1,
		InfrastructureFit:   0.8,
		CounterpartyClarity: 0.7,
		MacroSupport:        0.6,
		RouteReadiness:      0.5,
		Provenance:          0.4,
	})
	if score != 0.74 {
		t.Fatalf("expected weighted score 0.74, got %.3f", score)
	}
}

func TestScoreDealClampsInputs(t *testing.T) {
	score := ScoreDeal(DealScoreInput{
		MovementActivity:    3,
		InfrastructureFit:   -1,
		CounterpartyClarity: 0,
		MacroSupport:        2,
		RouteReadiness:      1,
		Provenance:          1,
	})
	if score != 0.6 {
		t.Fatalf("expected clamped weighted score 0.6, got %.3f", score)
	}
}

func TestSourceTiersDedupesAndDefaults(t *testing.T) {
	got := sourceTiers("Live", " live ", "", "inferred")
	if len(got) != 2 || got[0] != "live" || got[1] != "inferred" {
		t.Fatalf("unexpected tiers: %#v", got)
	}
	if fallback := sourceTiers("", " "); len(fallback) != 1 || fallback[0] != "inferred" {
		t.Fatalf("expected inferred fallback, got %#v", fallback)
	}
}
