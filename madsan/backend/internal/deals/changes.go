package deals

const ChangesTierNotImplemented = "not_implemented"

// ChangesScaffold returns an honest empty diff until living pack monitoring ships.
func ChangesScaffold(dealID string) map[string]any {
	return map[string]any{
		"deal_id": dealID,
		"tier":    ChangesTierNotImplemented,
		"changes": []any{},
	}
}
