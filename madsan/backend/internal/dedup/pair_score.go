package dedup

import (
	"math"
	"strings"
	"unicode"
)

// Review tiers align with docs/deduplication_strategy (honest — high confidence still queues for human merge).
const (
	TierHighConfidence = "high_confidence" // score >= 85
	TierManualReview   = "manual_review"   // 60–84
	TierSkip           = "skip"            // < 60
)

// PairTierLabel maps a 0–100 score to an honest review tier.
func PairTierLabel(score float64) string {
	switch {
	case score >= 85:
		return TierHighConfidence
	case score >= 60:
		return TierManualReview
	default:
		return TierSkip
	}
}

// ScoreCompanyPair scores one unordered duplicate candidate using name trigram similarity and country agreement.
func ScoreCompanyPair(a, b CompanyMember) float64 {
	nameA := normalizePairName(a.Name)
	nameB := normalizePairName(b.Name)
	score := trigramSimilarity(nameA, nameB) * 100

	if a.CountryCode != "" && b.CountryCode != "" {
		if strings.EqualFold(a.CountryCode, b.CountryCode) {
			score = math.Min(100, score+4)
		} else {
			score -= 16
		}
	}

	return clampScore(score)
}

func scoreCluster(members []CompanyMember) float64 {
	return ClusterPairScore(members)
}

// ClusterPairScore is the conservative cluster score: minimum pairwise score across members.
func ClusterPairScore(members []CompanyMember) float64 {
	if len(members) < 2 {
		return 0
	}
	minScore := 100.0
	for i := 0; i < len(members); i++ {
		for j := i + 1; j < len(members); j++ {
			s := ScoreCompanyPair(members[i], members[j])
			if s < minScore {
				minScore = s
			}
		}
	}
	return minScore
}

func normalizePairName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return ""
	}
	var b strings.Builder
	prevSpace := false
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			prevSpace = false
			continue
		}
		if !prevSpace {
			b.WriteByte(' ')
			prevSpace = true
		}
	}
	out := strings.TrimSpace(b.String())
	for _, suffix := range []string{" limited", " ltd", " llc", " inc", " corp", " corporation", " co", " company", " plc", " gmbh", " sa", " ag"} {
		if strings.HasSuffix(out, suffix) {
			out = strings.TrimSuffix(out, suffix)
		}
	}
	return strings.TrimSpace(out)
}

func trigrams(s string) map[string]int {
	out := map[string]int{}
	if s == "" {
		return out
	}
	padded := "  " + s + "  "
	for i := 0; i+3 <= len(padded); i++ {
		t := padded[i : i+3]
		out[t]++
	}
	return out
}

// trigramSimilarity approximates pg_trgm similarity for portable Go scoring (no Python/Splink runtime).
func trigramSimilarity(a, b string) float64 {
	if a == b {
		return 1
	}
	if a == "" || b == "" {
		return 0
	}
	ta, tb := trigrams(a), trigrams(b)
	shared := 0
	for t, ca := range ta {
		if cb, ok := tb[t]; ok {
			shared += minInt(ca, cb)
		}
	}
	den := len(ta) + len(tb)
	if den == 0 {
		return 0
	}
	return float64(2*shared) / float64(den)
}

func clampScore(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
