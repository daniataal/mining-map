package intelligence

import (
	"fmt"
	"math"
)

// STSScoreInput drives the public 6-factor weighted STS proximity model (AIS-observed).
type STSScoreInput struct {
	MinDistanceM     float64 `json:"min_distance_m"`
	DurationHours    float64 `json:"duration_hours"`
	AvgSOG           float64 `json:"avg_sog"`
	SpeedVariance    float64 `json:"speed_variance,omitempty"`
	DistanceVariance float64 `json:"distance_variance_m,omitempty"`
	BothTankers      bool    `json:"both_tankers"`
	InSTSZone        bool    `json:"in_sts_zone"`
	OutsideTerminal  bool    `json:"outside_terminal"`
	ZoneName         string  `json:"zone_name,omitempty"`
}

// STSScoreFactor is one explainable weighted component (0–1 factor score).
type STSScoreFactor struct {
	Name     string  `json:"name"`
	Weight   float64 `json:"weight"`
	Score    float64 `json:"score"`
	Weighted float64 `json:"weighted"`
	Detail   string  `json:"detail"`
}

// STSScoreResult is the fused STS confidence with honest observed tier for AIS proximity.
type STSScoreResult struct {
	Score       float64          `json:"score"`
	Confidence  string           `json:"confidence_tier"`
	DataTier    string           `json:"data_tier"`
	Factors     []STSScoreFactor `json:"factors"`
	Limitations []string         `json:"limitations"`
	Disclaimer  string           `json:"disclaimer"`
}

const (
	stsDataTierObserved = "observed"

	stsWeightDistanceTightness = 0.22
	stsWeightDuration          = 0.20
	stsWeightSpeedStability    = 0.18
	stsWeightDistanceVariance  = 0.15
	stsWeightIsolation         = 0.13
	stsWeightSTSZone           = 0.12
)

// ScoreSTS applies the 6-factor weighted STS model and returns a 0–100 score.
func ScoreSTS(in STSScoreInput) STSScoreResult {
	res := STSScoreResult{
		DataTier:   stsDataTierObserved,
		Disclaimer: "AIS proximity inference — not a confirmed ship-to-ship commodity transfer",
		Limitations: []string{
			"Provider coverage gaps (e.g. Persian Gulf) may hide real activity",
			"Seeded STS zones use approximate open-source polygons",
			"No draft delta or manifest linkage",
		},
	}

	if in.DurationHours < 2 || in.MinDistanceM > 500 || !in.OutsideTerminal {
		res.Score = 15
		res.Confidence = "low"
		res.Factors = buildSTSGatedFactors(in)
		return res
	}

	factors := []STSScoreFactor{
		{
			Name: "distance_tightness", Weight: stsWeightDistanceTightness,
			Score:  scoreDistanceTightness(in.MinDistanceM),
			Detail: fmt.Sprintf("min separation %.0f m", in.MinDistanceM),
		},
		{
			Name: "duration", Weight: stsWeightDuration,
			Score:  scoreDuration(in.DurationHours),
			Detail: fmt.Sprintf("%.1f h co-proximity", in.DurationHours),
		},
		{
			Name: "speed_stability", Weight: stsWeightSpeedStability,
			Score:  scoreSpeedStability(in.AvgSOG, in.SpeedVariance),
			Detail: fmt.Sprintf("avg SOG %.2f kn", in.AvgSOG),
		},
		{
			Name: "distance_variance", Weight: stsWeightDistanceVariance,
			Score:  scoreDistanceVariance(in.DistanceVariance, in.MinDistanceM),
			Detail: distanceVarianceDetail(in.DistanceVariance),
		},
		{
			Name: "isolation", Weight: stsWeightIsolation,
			Score:  scoreIsolation(in.BothTankers, in.OutsideTerminal),
			Detail: isolationDetail(in.BothTankers, in.OutsideTerminal),
		},
		{
			Name: "sts_zone_context", Weight: stsWeightSTSZone,
			Score:  scoreSTSZone(in.InSTSZone),
			Detail: stsZoneDetail(in.InSTSZone, in.ZoneName),
		},
	}

	var weighted float64
	for i := range factors {
		factors[i].Weighted = factors[i].Score * factors[i].Weight
		weighted += factors[i].Weighted
	}
	res.Factors = factors
	res.Score = math.Round(weighted * 100)
	res.Confidence = stsConfidenceTier(res.Score, in)
	return res
}

func buildSTSGatedFactors(in STSScoreInput) []STSScoreFactor {
	reason := "below STS detection threshold"
	switch {
	case !in.OutsideTerminal:
		reason = "centroid inside terminal geofence (likely berth)"
	case in.MinDistanceM > 500:
		reason = "separation exceeds 500 m"
	case in.DurationHours < 2:
		reason = "co-proximity under 2 hours"
	}
	return []STSScoreFactor{{
		Name: "gated", Weight: 1, Score: 0.15, Weighted: 0.15, Detail: reason,
	}}
}

func scoreDistanceTightness(minDistM float64) float64 {
	switch {
	case minDistM <= 150:
		return 1.0
	case minDistM <= 300:
		return 0.75
	case minDistM <= 500:
		return 0.5
	default:
		return 0
	}
}

func scoreDuration(hours float64) float64 {
	switch {
	case hours >= 6:
		return 1.0
	case hours >= 4:
		return 0.85
	case hours >= 2:
		return 0.55
	default:
		return 0.15
	}
}

func scoreSpeedStability(avgSOG, speedVariance float64) float64 {
	sogScore := 0.2
	switch {
	case avgSOG <= 0.5:
		sogScore = 1.0
	case avgSOG <= 1.0:
		sogScore = 0.8
	case avgSOG <= 1.5:
		sogScore = 0.55
	case avgSOG <= 2.0:
		sogScore = 0.35
	}
	if speedVariance <= 0 {
		return sogScore
	}
	variancePenalty := 0.0
	switch {
	case speedVariance <= 0.3:
		variancePenalty = 0
	case speedVariance <= 0.8:
		variancePenalty = 0.15
	default:
		variancePenalty = 0.35
	}
	return math.Max(0, sogScore-variancePenalty)
}

func scoreDistanceVariance(varianceM, minDistM float64) float64 {
	if varianceM <= 0 {
		// Proxy from tightness when bucket variance is unavailable.
		return scoreDistanceTightness(minDistM) * 0.85
	}
	switch {
	case varianceM <= 50:
		return 1.0
	case varianceM <= 120:
		return 0.7
	case varianceM <= 200:
		return 0.45
	default:
		return 0.2
	}
}

func distanceVarianceDetail(varianceM float64) string {
	if varianceM <= 0 {
		return "separation stability estimated from min distance"
	}
	return fmt.Sprintf("separation variance %.0f m", varianceM)
}

func scoreIsolation(bothTankers, outsideTerminal bool) float64 {
	if !outsideTerminal {
		return 0
	}
	if bothTankers {
		return 1.0
	}
	return 0.55
}

func isolationDetail(bothTankers, outsideTerminal bool) string {
	if !outsideTerminal {
		return "inside terminal geofence"
	}
	if bothTankers {
		return "open water, both tankers"
	}
	return "open water, mixed vessel classes"
}

func scoreSTSZone(inZone bool) float64 {
	if inZone {
		return 1.0
	}
	return 0.35
}

func stsZoneDetail(inZone bool, zoneName string) string {
	if inZone && zoneName != "" {
		return "known STS zone: " + zoneName
	}
	if inZone {
		return "inside seeded STS zone polygon"
	}
	return "open water outside seeded STS zones"
}

func stsConfidenceTier(score float64, in STSScoreInput) string {
	switch {
	case score >= 85 && in.BothTankers && in.InSTSZone && in.MinDistanceM <= 150 && in.DurationHours >= 4:
		return "very_high"
	case score >= 65 && in.BothTankers && (in.InSTSZone || in.MinDistanceM <= 200):
		return "high"
	case score >= 45 && in.BothTankers:
		return "medium"
	default:
		return "low"
	}
}
