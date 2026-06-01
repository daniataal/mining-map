package confidence

// ScorePortCall computes deterministic confidence for a closed port call.
func ScorePortCall(input Input) float64 {
	score := 0.0
	if input.InsideTerminal {
		score += 0.25
	}
	if input.DurationHours >= 6 {
		score += 0.15
	}
	if input.DurationHours >= 18 {
		score += 0.10
	}
	if input.DraftDeltaAbs >= 1.0 {
		score += 0.25
	}
	if input.KnownTanker {
		score += 0.10
	}
	if input.DestinationKnown {
		score += 0.10
	}
	if input.MatchingProductTerminal {
		score += 0.05
	}
	if input.DurationHours < 3 {
		score -= 0.15
	}
	if score < 0 {
		return 0
	}
	if score > 1 {
		return 1
	}
	return score
}

type Input struct {
	InsideTerminal          bool
	DurationHours           float64
	DraftDeltaAbs           float64
	KnownTanker             bool
	DestinationKnown        bool
	MatchingProductTerminal bool
}
