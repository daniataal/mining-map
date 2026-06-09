package dedup

import "testing"

func TestHighConfidenceOnlyEnqueueEligible(t *testing.T) {
	high := CompanyPair{MatchScore: 90, ReviewTier: TierHighConfidence}
	review := CompanyPair{MatchScore: 72, ReviewTier: TierManualReview}
	skip := CompanyPair{MatchScore: 45, ReviewTier: TierSkip}

	if high.ReviewTier != TierHighConfidence {
		t.Fatal("high pair should be high_confidence tier")
	}
	if review.ReviewTier == TierHighConfidence {
		t.Fatal("manual_review pair must not pass high_confidence filter")
	}
	if skip.ReviewTier == TierHighConfidence {
		t.Fatal("skip pair must not pass high_confidence filter")
	}
}

func TestPostImportEnqueueCapDefault(t *testing.T) {
	if PostImportEnqueueCap != 20 {
		t.Fatalf("expected cap 20, got %d", PostImportEnqueueCap)
	}
}

func TestClusterHighConfidenceFilter(t *testing.T) {
	high := CompanyCluster{ReviewTier: TierHighConfidence, MatchScore: 90}
	review := CompanyCluster{ReviewTier: TierManualReview, MatchScore: 72}
	if high.ReviewTier != TierHighConfidence {
		t.Fatal("high cluster should enqueue after import")
	}
	if review.ReviewTier == TierHighConfidence {
		t.Fatal("manual_review cluster should not enqueue after import")
	}
}
