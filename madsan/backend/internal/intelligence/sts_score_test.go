package intelligence

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type stsFixtureCase struct {
	Name      string        `json:"name"`
	Input     STSScoreInput `json:"input"`
	WantTier  string        `json:"want_tier"`
	WantScore float64       `json:"want_score"`
	MinScore  float64       `json:"min_score"`
}

func TestScoreSTS_Fixture(t *testing.T) {
	path := filepath.Join("testdata", "sts_score_fixture.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var cases []stsFixtureCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			res := ScoreSTS(tc.Input)
			if res.DataTier != stsDataTierObserved {
				t.Fatalf("data tier=%q want observed", res.DataTier)
			}
			if len(res.Factors) == 0 {
				t.Fatal("expected factor breakdown")
			}
			if tc.WantTier != "" && res.Confidence != tc.WantTier {
				t.Fatalf("tier=%s want %s score=%.0f", res.Confidence, tc.WantTier, res.Score)
			}
			if tc.WantScore > 0 && res.Score != tc.WantScore {
				t.Fatalf("score=%.0f want %.0f", res.Score, tc.WantScore)
			}
			if tc.MinScore > 0 && res.Score < tc.MinScore {
				t.Fatalf("score=%.0f below min %.0f", res.Score, tc.MinScore)
			}
		})
	}
}

func TestScoreSTS_SixFactorsWeighted(t *testing.T) {
	res := ScoreSTS(STSScoreInput{
		MinDistanceM: 200, DurationHours: 4.5, AvgSOG: 0.4,
		BothTankers: true, InSTSZone: true, OutsideTerminal: true, ZoneName: "Singapore",
	})
	if len(res.Factors) != 6 {
		t.Fatalf("expected 6 factors, got %d", len(res.Factors))
	}
	var weightSum float64
	for _, f := range res.Factors {
		weightSum += f.Weight
	}
	if weightSum < 0.99 || weightSum > 1.01 {
		t.Fatalf("weights sum %.3f want ~1.0", weightSum)
	}
	if res.Score <= 0 || res.Score > 100 {
		t.Fatalf("score out of range: %.0f", res.Score)
	}
}
