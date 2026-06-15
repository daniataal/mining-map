package dedup

import (
	"bytes"
	"strings"
	"testing"
)

func TestPairsFromClusters(t *testing.T) {
	clusters := []CompanyCluster{
		{
			NormalizedName: "acme",
			MatchScore:     88,
			Members: []CompanyMember{
				{ID: "a", Name: "Acme A"},
				{ID: "b", Name: "Acme B"},
				{ID: "c", Name: "Acme C"},
			},
		},
		{
			NormalizedName: "solo",
			Members:        []CompanyMember{{ID: "x", Name: "Solo"}},
		},
	}
	pairs := PairsFromClusters(clusters)
	if len(pairs) != 3 {
		t.Fatalf("expected 3 pairs, got %d", len(pairs))
	}
	if pairs[0].Left.ID != "a" || pairs[0].Right.ID != "b" {
		t.Fatalf("unexpected first pair: %+v", pairs[0])
	}
	if pairs[0].NormalizedName != "acme" {
		t.Fatalf("cluster metadata missing: %+v", pairs[0])
	}
	if pairs[0].MatchScore <= 0 || pairs[0].ReviewTier == "" {
		t.Fatalf("expected pairwise score and tier: %+v", pairs[0])
	}
}

func TestWriteCompanyPairsCSV(t *testing.T) {
	conf := 0.9
	var buf bytes.Buffer
	left := CompanyMember{ID: "a", Name: "Acme A", CountryCode: "AE", ConfidenceScore: &conf}
	right := CompanyMember{ID: "b", Name: "Acme B", CountryCode: "US"}
	pairScore := ScoreCompanyPair(left, right)
	err := WriteCompanyPairsCSV(&buf, []CompanyPair{{
		NormalizedName: "acme",
		MatchScore:     pairScore,
		ReviewTier:     PairTierLabel(pairScore),
		Left:           left,
		Right:          right,
	}})
	if err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if !strings.HasPrefix(out, "unique_id_l,unique_id_r,") {
		t.Fatalf("missing header: %q", out)
	}
	if !strings.Contains(out, "a,b,Acme A,Acme B,AE,US,0.9,,acme,") {
		t.Fatalf("unexpected row: %q", out)
	}
	for _, tier := range []string{TierHighConfidence, TierManualReview, TierSkip} {
		if strings.Contains(out, tier) {
			return
		}
	}
	t.Fatalf("expected review_tier in row: %q", out)
}
