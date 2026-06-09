package dedup

import "testing"

func TestPairTierLabel(t *testing.T) {
	cases := []struct {
		score float64
		want  string
	}{
		{90, TierHighConfidence},
		{85, TierHighConfidence},
		{84, TierManualReview},
		{60, TierManualReview},
		{59, TierSkip},
	}
	for _, c := range cases {
		if got := PairTierLabel(c.score); got != c.want {
			t.Fatalf("PairTierLabel(%v) = %q, want %q", c.score, got, c.want)
		}
	}
}

func TestScoreCompanyPair_sameCountryHigh(t *testing.T) {
	score := ScoreCompanyPair(
		CompanyMember{Name: "Acme Mining Ltd", CountryCode: "AE"},
		CompanyMember{Name: "ACME Mining Limited", CountryCode: "AE"},
	)
	if score < 85 {
		t.Fatalf("same country near-identical names should be high confidence: %v", score)
	}
	if PairTierLabel(score) != TierHighConfidence {
		t.Fatalf("expected high_confidence tier, got %s", PairTierLabel(score))
	}
}

func TestScoreCompanyPair_mixedCountryReview(t *testing.T) {
	score := ScoreCompanyPair(
		CompanyMember{Name: "Acme Mining Ltd", CountryCode: "AE"},
		CompanyMember{Name: "Acme Mining Ltd", CountryCode: "US"},
	)
	if score >= 85 {
		t.Fatalf("mixed country should not auto-queue: %v", score)
	}
	if score < 60 {
		t.Fatalf("identical names mixed country should still review: %v", score)
	}
	if PairTierLabel(score) != TierManualReview {
		t.Fatalf("expected manual_review tier, got %s", PairTierLabel(score))
	}
}

func TestScoreCompanyPair_dissimilarSkip(t *testing.T) {
	score := ScoreCompanyPair(
		CompanyMember{Name: "Acme Mining", CountryCode: "AE"},
		CompanyMember{Name: "Totally Different Corp", CountryCode: "US"},
	)
	if score >= 60 {
		t.Fatalf("dissimilar names should skip: %v", score)
	}
}

func TestClusterPairScore_conservativeMin(t *testing.T) {
	members := []CompanyMember{
		{Name: "Acme Mining Ltd", CountryCode: "AE"},
		{Name: "Acme Mining Limited", CountryCode: "AE"},
		{Name: "Acme Mining Ltd", CountryCode: "US"},
	}
	cluster := ClusterPairScore(members)
	pairHigh := ScoreCompanyPair(members[0], members[1])
	pairLow := ScoreCompanyPair(members[0], members[2])
	if cluster != pairLow {
		t.Fatalf("cluster score should be min pair (%v), got %v (high pair %v)", pairLow, cluster, pairHigh)
	}
}
