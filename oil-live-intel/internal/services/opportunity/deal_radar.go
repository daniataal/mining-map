package opportunity

import (
	"math"
	"strings"
)

type DealScoreInput struct {
	MovementActivity    float64
	InfrastructureFit   float64
	CounterpartyClarity float64
	MacroSupport        float64
	RouteReadiness      float64
	Provenance          float64
}

type DealRadarAction struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
}

var defaultDealRadarActions = []DealRadarAction{
	{ID: "view_details", Label: "View details", Kind: "drawer"},
	{ID: "build_route", Label: "Build route", Kind: "route"},
	{ID: "open_deal_pack", Label: "Open deal pack", Kind: "deal_pack"},
	{ID: "save_supplier", Label: "Save supplier", Kind: "supplier"},
	{ID: "verify_source", Label: "Verify source", Kind: "verification"},
}

func ScoreDeal(in DealScoreInput) float64 {
	score := 0.25*clamp01(in.MovementActivity) +
		0.20*clamp01(in.InfrastructureFit) +
		0.20*clamp01(in.CounterpartyClarity) +
		0.20*clamp01(in.MacroSupport) +
		0.10*clamp01(in.RouteReadiness) +
		0.05*clamp01(in.Provenance)
	return round3(score)
}

func clamp01(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func round3(v float64) float64 {
	return math.Round(v*1000) / 1000
}

func sourceTiers(values ...string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, v := range values {
		key := strings.TrimSpace(strings.ToLower(v))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, key)
	}
	if len(out) == 0 {
		return []string{"inferred"}
	}
	return out
}

func signalPayload(
	signalKind string,
	score DealScoreInput,
	commodity string,
	evidence []string,
	counterpartyHints []map[string]any,
	infrastructureHints []map[string]any,
) map[string]any {
	return map[string]any{
		"signal_kind":          signalKind,
		"commodity_family":     commodity,
		"scoring":              score,
		"recommended_actions":  defaultDealRadarActions,
		"why_this_matters":     evidence,
		"counterparty_hints":   counterpartyHints,
		"infrastructure_hints": infrastructureHints,
		"honesty_note":         "Inferred public-data lead only; not a confirmed buyer, seller, storage slot, or cargo listing.",
	}
}
