package intelligence

import "testing"

func TestScoreSTS(t *testing.T) {
	score := ScoreSTS(STSScoreInput{
		DistanceM: 200, DurationMin: 45, SpeedDelta: 1, FlagMismatch: true, AISGapMinutes: 90,
	})
	if score < 50 {
		t.Fatalf("expected meaningful STS score, got %v", score)
	}
}
