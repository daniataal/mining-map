package dedup

import "testing"

func TestClusterMergeReviewEligible(t *testing.T) {
	high := CompanyCluster{ReviewTier: TierHighConfidence, MatchScore: 90}
	review := CompanyCluster{ReviewTier: TierManualReview, MatchScore: 72}
	skip := CompanyCluster{ReviewTier: TierSkip, MatchScore: 40}
	if !clusterMergeReviewEligible(high) {
		t.Fatal("high_confidence cluster should be eligible for merge review enqueue")
	}
	if clusterMergeReviewEligible(review) || clusterMergeReviewEligible(skip) {
		t.Fatal("only high_confidence clusters should enqueue via merge review button")
	}
}

func TestBuildClusterMergeReviewPayload(t *testing.T) {
	cluster := CompanyCluster{
		NormalizedName: "acme mining",
		Count:          2,
		MatchScore:     92,
		ReviewTier:     TierHighConfidence,
		Members: []CompanyMember{
			{ID: "a", Name: "Acme Mining Ltd", CountryCode: "AE"},
			{ID: "b", Name: "Acme Mining Limited", CountryCode: "AE"},
		},
	}
	payload := buildClusterMergeReviewPayload(cluster)
	if payload["review_tier"] != TierHighConfidence {
		t.Fatalf("expected high_confidence tier, got %v", payload["review_tier"])
	}
	if payload["pair_type"] != "same_name_cluster" {
		t.Fatalf("expected same_name_cluster pair_type, got %v", payload["pair_type"])
	}
	if payload["normalized_name"] != "acme mining" {
		t.Fatalf("unexpected normalized_name: %v", payload["normalized_name"])
	}
}

func TestIsMergeReviewReason(t *testing.T) {
	if !IsMergeReviewReason(ReasonDedupMerge) || !IsMergeReviewReason("duplicate_company") {
		t.Fatal("dedup merge and duplicate_company reasons should support merge actions")
	}
	if IsMergeReviewReason("supplier_offer") {
		t.Fatal("unrelated reasons should not support merge actions")
	}
}
