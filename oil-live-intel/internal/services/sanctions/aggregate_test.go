package sanctions

import "testing"

func TestAggregateFlagLevel(t *testing.T) {
	cases := []struct {
		flagged, review int
		want            FlagLevel
	}{
		{0, 0, FlagClear},
		{0, 2, FlagReview},
		{1, 0, FlagFlagged},
		{1, 5, FlagFlagged},
	}
	for _, tc := range cases {
		if got := AggregateFlagLevel(tc.flagged, tc.review); got != tc.want {
			t.Fatalf("AggregateFlagLevel(%d,%d)=%q want %q", tc.flagged, tc.review, got, tc.want)
		}
	}
}

func TestMatchCount(t *testing.T) {
	if got := MatchCount(2, 3); got != 5 {
		t.Fatalf("MatchCount=%d want 5", got)
	}
}

func TestWorstStatus(t *testing.T) {
	if got := WorstStatus("clear", "review", "clear"); got != FlagReview {
		t.Fatalf("WorstStatus review: got %q", got)
	}
	if got := WorstStatus("review", "flagged"); got != FlagFlagged {
		t.Fatalf("WorstStatus flagged: got %q", got)
	}
	if got := WorstStatus("clear", "", "unknown"); got != FlagClear {
		t.Fatalf("WorstStatus clear: got %q", got)
	}
}
