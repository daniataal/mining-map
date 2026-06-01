package volume

// EstimateBarrels returns estimated barrels from DWT and draft ratio; ok false if insufficient data.
func EstimateBarrels(deadweightTons, draftDelta, maxDraftM float64) (barrels float64, ok bool) {
	if deadweightTons <= 0 || maxDraftM <= 0 || draftDelta == 0 {
		return 0, false
	}
	ratio := draftDelta / maxDraftM
	if ratio < 0 {
		ratio = -ratio
	}
	if ratio > 1 {
		ratio = 1
	}
	cargoTons := deadweightTons * ratio
	return cargoTons * 7.33, true
}
