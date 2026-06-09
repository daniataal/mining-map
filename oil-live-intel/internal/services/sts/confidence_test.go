package sts

import "testing"

func TestScore_VeryHighTankersInZone(t *testing.T) {
	tier, score := Score(ScoreInput{
		DurationHours:   5,
		MinDistanceM:    120,
		AvgSOG:          0.3,
		BothTankers:     true,
		SameTankerClass: true,
		InSTSZone:       true,
		OutsideTerminal: true,
		SampleBuckets:   10,
	})
	if tier != TierVeryHigh {
		t.Fatalf("tier=%s want %s score=%v", tier, TierVeryHigh, score)
	}
	if score < 0.8 {
		t.Fatalf("expected high score, got %v", score)
	}
}

func TestScore_ExcludedTerminal(t *testing.T) {
	tier, _ := Score(ScoreInput{
		DurationHours:   6,
		MinDistanceM:    100,
		BothTankers:     true,
		OutsideTerminal: false,
	})
	if tier != TierLow {
		t.Fatalf("terminal overlap should force low tier, got %s", tier)
	}
}

func TestScore_ShortDurationLow(t *testing.T) {
	tier, _ := Score(ScoreInput{
		DurationHours:   1,
		MinDistanceM:    100,
		BothTankers:     true,
		OutsideTerminal: true,
	})
	if tier != TierLow {
		t.Fatalf("short duration should be low, got %s", tier)
	}
}

func TestOrderMMSI(t *testing.T) {
	a, b := OrderMMSI(900000002, 900000001)
	if a != 900000001 || b != 900000002 {
		t.Fatalf("got %d %d", a, b)
	}
}

func TestBuildEvidence_DisclaimerPresent(t *testing.T) {
	ev := BuildEvidence(ScoreInput{DurationHours: 3, MinDistanceM: 200, AvgSOG: 0.4, OutsideTerminal: true}, "crude", "crude", "Fujairah")
	if len(ev) < 2 {
		t.Fatal("expected evidence lines")
	}
	if ev[0] == "" {
		t.Fatal("empty disclaimer")
	}
}
