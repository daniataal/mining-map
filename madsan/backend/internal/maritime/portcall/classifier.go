package portcall

const (
	EventPossibleLoading   = "possible_loading"
	EventPossibleUnloading = "possible_unloading"
	EventTerminalUnknown   = "terminal_visit_unknown"
)

func ClassifyEvent(draftIn, draftOut float64, hasDraft bool) string {
	if !hasDraft {
		return EventTerminalUnknown
	}
	delta := draftOut - draftIn
	if delta >= 1.0 {
		return EventPossibleLoading
	}
	if delta <= -1.0 {
		return EventPossibleUnloading
	}
	return EventTerminalUnknown
}
