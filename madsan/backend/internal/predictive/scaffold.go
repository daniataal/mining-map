package predictive

const TierNotImplemented = "not_implemented"

type StatusResponse struct {
	Tier        string   `json:"tier"`
	Status      string   `json:"status"`
	Message     string   `json:"message"`
	SignalTypes []string `json:"signal_types"`
	Signals     []any    `json:"signals"`
	Limitations []string `json:"limitations"`
}

type RunResult struct {
	Horizons    []int `json:"horizons"`
	RowsScored  int   `json:"rows_scored"`
	RowsWritten int   `json:"rows_written"`
	DurationMS  int64 `json:"duration_ms"`
}

func ScaffoldStatus() StatusResponse {
	return StatusResponse{
		Tier:    TierNotImplemented,
		Status:  "scaffold",
		Message: "Predictive models (STS, destination, storage forecast) not trained or served yet",
		SignalTypes: []string{
			"sts_prediction",
			"destination_prediction",
			"storage_build_draw_forecast",
		},
		Signals: []any{},
		Limitations: []string{
			"predictive_signals table exists but has no model-generated rows",
			"outputs will be tiered as predictions with explicit horizon and confidence",
			"no gradient-boosted STS classifier wired",
		},
	}
}
