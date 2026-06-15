package dedup

import "testing"

func TestScoreCluster(t *testing.T) {
	same := []CompanyMember{
		{Name: "Acme Mining Ltd", CountryCode: "AE"},
		{Name: "Acme Mining Limited", CountryCode: "AE"},
	}
	if score := scoreCluster(same); score < 85 {
		t.Fatalf("same country near-identical names should score high: %v", score)
	}
	mixed := []CompanyMember{
		{Name: "Acme Mining Ltd", CountryCode: "AE"},
		{Name: "Acme Mining Ltd", CountryCode: "US"},
	}
	if score := scoreCluster(mixed); score >= 85 {
		t.Fatalf("mixed country should be manual review tier: %v", score)
	}
	if PairTierLabel(scoreCluster(mixed)) != TierManualReview {
		t.Fatalf("expected manual_review tier for mixed country cluster")
	}
}
