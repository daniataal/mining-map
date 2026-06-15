package predictive

import "testing"

func TestScoreSTSPairPredictionStrongPair(t *testing.T) {
	score := ScoreSTSPairPrediction(STSPairPredictionInput{
		DistanceM:             180,
		AvgSOG:                0.6,
		BothTankers:           true,
		InKnownSTSZone:        true,
		ZoneName:              "Fujairah STS Area",
		ProductCompatible:     true,
		HasCargoEstimate:      true,
		HasDraftSignal:        true,
		SupplierLinkedVessel:  true,
		BuyerLinkedVessel:     true,
		OpportunityMatched:    true,
		MarketPressureScore:   90,
		PriceContextAvailable: true,
	})
	if score.FuturePairProbability < 80 {
		t.Fatalf("expected strong pair prediction, got %.0f", score.FuturePairProbability)
	}
	if score.ContextLabel != "offshore STS zone" {
		t.Fatalf("expected offshore context, got %q", score.ContextLabel)
	}
}

func TestScoreSTSPairPredictionProductMismatchPenalty(t *testing.T) {
	compatible := ScoreSTSPairPrediction(STSPairPredictionInput{
		DistanceM:         900,
		AvgSOG:            1.2,
		BothTankers:       true,
		ProductCompatible: true,
		HasCargoEstimate:  true,
	})
	mismatch := ScoreSTSPairPrediction(STSPairPredictionInput{
		DistanceM:         900,
		AvgSOG:            1.2,
		BothTankers:       true,
		ProductCompatible: false,
		HasCargoEstimate:  true,
	})
	if mismatch.FuturePairProbability >= compatible.FuturePairProbability {
		t.Fatalf("expected product mismatch penalty, compatible %.0f mismatch %.0f", compatible.FuturePairProbability, mismatch.FuturePairProbability)
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
