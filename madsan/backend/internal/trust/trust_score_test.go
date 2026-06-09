package trust

import (
	"testing"
	"time"

	"github.com/madsan/intelligence/internal/intelligence"
)

func TestComputeRegisterBoost(t *testing.T) {
	ts := time.Now().Add(-1 * time.Hour)
	signals, _ := intelligence.VesselSignals(&ts, nil, 60)
	res := Compute(Input{
		EntityType: "vessel", EntityID: "test-id",
		BaseConfidence: 60, EvidenceCount: 2, Signals: signals,
	})
	if res.Score < 520 {
		t.Fatalf("expected fresh AIS boost, score=%d reasons=%+v", res.Score, res.Reasons)
	}
	if res.Tier != "inferred" {
		t.Fatalf("tier=%q want inferred", res.Tier)
	}
	if res.ModelVersion != ModelVersion {
		t.Fatalf("model=%q", res.ModelVersion)
	}
}

func TestComputeSanctionsPenalty(t *testing.T) {
	res := Compute(Input{
		EntityType: "company", EntityID: "c1",
		BaseConfidence: 70, EvidenceCount: 3,
		RiskFlags: []RiskFlag{{FlagType: "sanctions_match", Severity: "critical"}},
	})
	if res.Score >= 500 {
		t.Fatalf("expected sanctions penalty, score=%d", res.Score)
	}
	found := false
	for _, r := range res.Reasons {
		if r.Impact == "negative" && r.WOE <= -100 {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing strong negative reason: %+v", res.Reasons)
	}
}

func TestComputeClamps(t *testing.T) {
	res := Compute(Input{
		EntityType: "company", EntityID: "c1",
		BaseConfidence: 100, EvidenceCount: 20,
		Signals: []intelligence.EntitySignal{
			{SignalType: "supplier_tier", Label: "Gov register", Tier: "observed", Score: 80},
		},
		RelationshipCount: 10,
		DataQualityStatus: "verified",
	})
	if res.Score > MaxScore || res.Score < MinScore {
		t.Fatalf("score %d out of range [%d,%d]", res.Score, MinScore, MaxScore)
	}
}

func TestGradeFor(t *testing.T) {
	cases := map[int]string{400: "low", 500: "fair", 580: "good", 700: "strong"}
	for score, want := range cases {
		if got := gradeFor(score); got != want {
			t.Fatalf("gradeFor(%d)=%q want %q", score, got, want)
		}
	}
}
