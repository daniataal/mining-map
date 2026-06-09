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
	if pairs[0].NormalizedName != "acme" || pairs[0].MatchScore != 88 {
		t.Fatalf("cluster metadata missing: %+v", pairs[0])
	}
}

func TestWriteCompanyPairsCSV(t *testing.T) {
	conf := 0.9
	var buf bytes.Buffer
	err := WriteCompanyPairsCSV(&buf, []CompanyPair{{
		NormalizedName: "acme",
		MatchScore:     88,
		Left:           CompanyMember{ID: "a", Name: "Acme A", CountryCode: "AE", ConfidenceScore: &conf},
		Right:          CompanyMember{ID: "b", Name: "Acme B", CountryCode: "US"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if !strings.HasPrefix(out, "unique_id_l,unique_id_r,") {
		t.Fatalf("missing header: %q", out)
	}
	if !strings.Contains(out, "a,b,Acme A,Acme B,AE,US,0.9,,acme,88") {
		t.Fatalf("unexpected row: %q", out)
	}
}
