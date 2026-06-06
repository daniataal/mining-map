package sanctions

import "strings"

// FlagLevel is the worst-case screening signal for a country aggregate.
type FlagLevel string

const (
	FlagClear   FlagLevel = "clear"
	FlagReview  FlagLevel = "review"
	FlagFlagged FlagLevel = "flagged"
)

// AggregateFlagLevel derives country-level signal from screened entity counts.
// flagged > review > clear; unscreened countries are omitted by callers.
func AggregateFlagLevel(flagged, review int) FlagLevel {
	if flagged > 0 {
		return FlagFlagged
	}
	if review > 0 {
		return FlagReview
	}
	return FlagClear
}

// MatchCount counts entities that need operator review (review + flagged).
func MatchCount(flagged, review int) int {
	return flagged + review
}

// WorstStatus picks the strongest status from individual entity statuses.
func WorstStatus(statuses ...string) FlagLevel {
	worst := FlagClear
	for _, raw := range statuses {
		switch strings.ToLower(strings.TrimSpace(raw)) {
		case "flagged":
			return FlagFlagged
		case "review":
			if worst != FlagFlagged {
				worst = FlagReview
			}
		}
	}
	return worst
}
