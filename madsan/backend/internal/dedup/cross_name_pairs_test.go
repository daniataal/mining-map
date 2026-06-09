package dedup

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestCrossNameCountryEligible(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"AE", "AE", true},
		{"ae", "AE", true},
		{"AE", "US", false},
		{"", "US", true},
		{"AE", "", true},
		{"", "", true},
	}
	for _, c := range cases {
		if got := crossNameCountryEligible(c.a, c.b); got != c.want {
			t.Fatalf("crossNameCountryEligible(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

func TestBuildScoredCrossNamePair(t *testing.T) {
	left := CompanyMember{ID: "a", Name: "Acme Mining Ltd", CountryCode: "AE"}
	right := CompanyMember{ID: "b", Name: "Acme Mining Limited", CountryCode: "AE"}
	pair := buildScoredCrossNamePair(left, right, "acme mining", "acme mining ltd")

	if pair.NormalizedName != "acme mining|acme mining ltd" {
		t.Fatalf("unexpected normalized label: %q", pair.NormalizedName)
	}
	if pair.MatchScore < 85 {
		t.Fatalf("near-identical same-country pair should score high: %v", pair.MatchScore)
	}
	if pair.ReviewTier != TierHighConfidence {
		t.Fatalf("expected high_confidence tier, got %q", pair.ReviewTier)
	}
	if pair.Left.ID != "a" || pair.Right.ID != "b" {
		t.Fatalf("unexpected members: %+v", pair)
	}
}

func TestBuildScoredCrossNamePair_mixedCountryReview(t *testing.T) {
	left := CompanyMember{ID: "a", Name: "Acme Mining Ltd", CountryCode: "AE"}
	right := CompanyMember{ID: "b", Name: "Acme Mining Ltd", CountryCode: "US"}
	pair := buildScoredCrossNamePair(left, right, "acme", "acme mining")

	if pair.ReviewTier != TierManualReview {
		t.Fatalf("mixed country should be manual_review, got %q (score %.1f)", pair.ReviewTier, pair.MatchScore)
	}
}

func TestCrossNamePairLabel(t *testing.T) {
	if got := crossNamePairLabel("same", "same"); got != "same" {
		t.Fatalf("same norms should collapse: %q", got)
	}
	if got := crossNamePairLabel("alpha", "beta"); got != "alpha|beta" {
		t.Fatalf("different norms should join: %q", got)
	}
}

func TestCrossNamePairKey_orderIndependent(t *testing.T) {
	a := "00000000-0000-0000-0000-000000000001"
	b := "00000000-0000-0000-0000-000000000002"
	if got := crossNamePairKey(a, b); got != a+"|"+b {
		t.Fatalf("expected sorted key %q, got %q", a+"|"+b, got)
	}
	if got := crossNamePairKey(b, a); got != a+"|"+b {
		t.Fatalf("pair key should be order-independent, got %q", got)
	}
}

func TestCrossNameEnqueueEligible(t *testing.T) {
	high := CompanyPair{MatchScore: 90, ReviewTier: TierHighConfidence}
	review := CompanyPair{MatchScore: 72, ReviewTier: TierManualReview}
	skip := CompanyPair{MatchScore: 45, ReviewTier: TierSkip}
	if !crossNameEnqueueEligible(high) || !crossNameEnqueueEligible(review) {
		t.Fatal("high_confidence and manual_review pairs should enqueue")
	}
	if crossNameEnqueueEligible(skip) {
		t.Fatal("skip-tier pairs should not enqueue")
	}
}

func TestBuildCrossNameEnqueuePayload(t *testing.T) {
	leftID := uuid.New().String()
	rightID := uuid.New().String()
	left := CompanyMember{ID: leftID, Name: "Acme Mining Ltd", CountryCode: "AE"}
	right := CompanyMember{ID: rightID, Name: "Acme Mining Limited", CountryCode: "AE"}
	pair := buildScoredCrossNamePair(left, right, "acme mining", "acme mining ltd")
	payload := buildCrossNameEnqueuePayload(pair)

	if payload["scoring_method"] != "cross_name_trgm_v1" {
		t.Fatalf("expected cross_name_trgm_v1 scoring_method, got %v", payload["scoring_method"])
	}
	if payload["pair_type"] != "cross_name" {
		t.Fatalf("expected cross_name pair_type, got %v", payload["pair_type"])
	}
	if payload["left_id"] != leftID || payload["right_id"] != rightID {
		t.Fatalf("unexpected pair ids: %+v", payload)
	}
	if payload["review_tier"] != TierHighConfidence {
		t.Fatalf("expected high_confidence tier, got %v", payload["review_tier"])
	}
	if payload["pair_key"] != crossNamePairKey(leftID, rightID) {
		t.Fatalf("pair_key mismatch: %v", payload["pair_key"])
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	ids, err := memberIDsFromPayload(raw)
	if err != nil {
		t.Fatalf("payload should be mergeable via members: %v", err)
	}
	if len(ids) != 2 {
		t.Fatalf("expected 2 member ids for merge, got %d", len(ids))
	}
}
