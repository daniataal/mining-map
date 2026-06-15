package confidence

import "math"

// Score applies additive rules from confidence_scoring_strategy.md
func Score(base float64, signals map[string]bool) float64 {
	s := base
	if signals["government_source"] {
		s += 35
	}
	if signals["official_website"] {
		s += 25
	}
	if signals["paid_provider"] {
		s += 25
	}
	if signals["multi_source"] {
		s += 20
	}
	if signals["has_coordinates"] {
		s += 10
	}
	if signals["has_contact"] {
		s += 5
	}
	if signals["registration_number"] {
		s += 15
	}
	if signals["recent_verification"] {
		s += 10
	}
	if signals["weak_single_source"] {
		s -= 20
	}
	if signals["no_coordinates"] {
		s -= 10
	}
	if signals["name_conflict"] {
		s -= 15
	}
	if signals["sanctions_risk"] {
		s -= 40
	}
	if signals["document_mismatch"] {
		s -= 25
	}
	if s > 100 {
		return 100
	}
	if s < 0 {
		return 0
	}
	return s
}

func Status(score float64) string {
	switch {
	case score >= 80:
		return "verified"
	case score >= 50:
		return "partially_verified"
	case score >= 30:
		return "unverified"
	default:
		return "high_risk"
	}
}

// FusionLogOdds combines independent signal weights into probability [0,1].
func FusionLogOdds(prior float64, weights ...float64) float64 {
	logit := func(p float64) float64 {
		if p <= 0.0001 {
			p = 0.0001
		}
		if p >= 0.9999 {
			p = 0.9999
		}
		return mathLogit(p)
	}
	invLogit := func(x float64) float64 {
		return 1 / (1 + mathExp(-x))
	}
	sum := logit(prior)
	for _, w := range weights {
		sum += w
	}
	return invLogit(sum)
}

func mathLogit(p float64) float64 {
	return math.Log(p / (1 - p))
}

func mathExp(x float64) float64 {
	return math.Exp(x)
}
