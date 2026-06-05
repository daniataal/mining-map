package sts

import (
	"fmt"
	"math"
)

const (
	TierLow      = "low"
	TierMedium   = "medium"
	TierHigh     = "high"
	TierVeryHigh = "very_high"
	TierVerified = "verified"
)

// ScoreInput drives deterministic STS confidence tiers from AIS proximity evidence.
type ScoreInput struct {
	DurationHours   float64
	MinDistanceM    float64
	AvgSOG          float64
	BothTankers     bool
	SameTankerClass bool
	InSTSZone       bool
	OutsideTerminal bool
	SampleBuckets   int
}

// Score returns a tier label and 0–1 score. Verified is never auto-assigned.
func Score(in ScoreInput) (tier string, score float64) {
	if in.DurationHours < 2 || in.MinDistanceM > 500 || !in.OutsideTerminal {
		return TierLow, 0.15
	}

	score = 0.25
	if in.DurationHours >= 2 {
		score += 0.10
	}
	if in.DurationHours >= 4 {
		score += 0.10
	}
	if in.MinDistanceM <= 300 {
		score += 0.10
	}
	if in.MinDistanceM <= 150 {
		score += 0.10
	}
	if in.AvgSOG <= 0.5 {
		score += 0.05
	}
	if in.BothTankers {
		score += 0.10
	}
	if in.SameTankerClass {
		score += 0.05
	}
	if in.InSTSZone {
		score += 0.15
	}
	if in.SampleBuckets >= 8 {
		score += 0.05
	}
	score = math.Min(1, math.Max(0, score))

	switch {
	case score >= 0.85 && in.BothTankers && in.InSTSZone && in.MinDistanceM <= 150 && in.DurationHours >= 4:
		return TierVeryHigh, score
	case score >= 0.65 && in.BothTankers && (in.InSTSZone || in.MinDistanceM <= 200):
		return TierHigh, score
	case score >= 0.45 && in.BothTankers:
		return TierMedium, score
	default:
		return TierLow, score
	}
}

// BuildEvidence returns human-readable inference lines for API/storage.
func BuildEvidence(in ScoreInput, vesselAClass, vesselBClass string, zoneName string) []string {
	out := []string{
		"Inferred from public AIS proximity — not a confirmed ship-to-ship commodity transfer",
		"Provider coverage gaps (e.g. Persian Gulf) may hide real activity",
	}
	if in.DurationHours > 0 {
		out = append(out, formatHours("Co-proximity duration", in.DurationHours))
	}
	if in.MinDistanceM > 0 {
		out = append(out, formatMeters("Minimum separation", in.MinDistanceM))
	}
	if in.AvgSOG >= 0 {
		out = append(out, formatKnots("Average speed over ground", in.AvgSOG))
	}
	if vesselAClass != "" || vesselBClass != "" {
		out = append(out, "Vessel classes: "+vesselAClass+" / "+vesselBClass)
	}
	if zoneName != "" {
		out = append(out, "Inside known STS zone: "+zoneName)
	} else if in.InSTSZone {
		out = append(out, "Inside a seeded STS zone polygon")
	}
	if !in.OutsideTerminal {
		out = append(out, "Excluded: centroid inside terminal geofence (likely berth, not STS)")
	}
	return out
}

func formatHours(label string, h float64) string {
	return label + ": " + trimFloat(h, 1) + " hours"
}

func formatMeters(label string, m float64) string {
	return label + ": " + trimFloat(m, 0) + " m"
}

func formatKnots(label string, k float64) string {
	return label + ": " + trimFloat(k, 2) + " kn"
}

func trimFloat(v float64, decimals int) string {
	pow := math.Pow(10, float64(decimals))
	rounded := math.Round(v*pow) / pow
	return fmt.Sprintf("%.*f", decimals, rounded)
}
