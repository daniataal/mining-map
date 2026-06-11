package predictive

import "testing"

func TestScoreSTSPairPredictionStrongPair(t *testing.T) {
	score := ScoreSTSPairPrediction(STSPairPredictionInput{
		DistanceM:      180,
		AvgSOG:         0.6,
		BothTankers:    true,
		InKnownSTSZone: true,
		ZoneName:       "Fujairah STS Area",
	})
	if score.FuturePairProbability < 80 {
		t.Fatalf("expected strong pair prediction, got %.0f", score.FuturePairProbability)
	}
	if score.ContextLabel != "offshore STS zone" {
		t.Fatalf("expected offshore context, got %q", score.ContextLabel)
	}
}

func TestScoreSTSPairPredictionTerminalPenalty(t *testing.T) {
	openWater := ScoreSTSPairPrediction(STSPairPredictionInput{
		DistanceM:       180,
		AvgSOG:          0.6,
		BothTankers:     true,
		TimeSkewSeconds: 60,
	})
	terminal := ScoreSTSPairPrediction(STSPairPredictionInput{
		DistanceM:                180,
		AvgSOG:                   0.6,
		BothTankers:              true,
		NearestTerminalDistanceM: 900,
		TimeSkewSeconds:          60,
	})
	if terminal.FuturePairProbability >= openWater.FuturePairProbability {
		t.Fatalf("expected terminal penalty, open %.0f terminal %.0f", openWater.FuturePairProbability, terminal.FuturePairProbability)
	}
	if terminal.ReviewTier != "review" {
		t.Fatalf("expected review tier near terminal, got %s", terminal.ReviewTier)
	}
}
