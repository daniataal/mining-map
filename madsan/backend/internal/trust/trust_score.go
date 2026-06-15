package trust

import (
	"math"
	"sort"
	"strings"

	"github.com/madsan/intelligence/internal/intelligence"
)

const (
	ModelVersion = "woe_scaffold_v1"
	BaseScore    = 500
	MinScore     = 300
	MaxScore     = 850
)

// RiskFlag is a lightweight risk input for trust scoring.
type RiskFlag struct {
	FlagType string
	Severity string
}

// Input aggregates dossier signals used by the scaffold scorecard.
type Input struct {
	EntityType        string
	EntityID          string
	BaseConfidence    float64
	DataQualityStatus string
	EvidenceCount     int
	Signals           []intelligence.EntitySignal
	RiskFlags         []RiskFlag
	RelationshipCount int
}

// ReasonCode is a WOE-style explainability line (honest inferred tier).
type ReasonCode struct {
	Code   string  `json:"code"`
	Label  string  `json:"label"`
	WOE    float64 `json:"woe"`
	Impact string  `json:"impact"`
	Tier   string  `json:"tier"`
	Detail string  `json:"detail,omitempty"`
}

// Result is the MadSan Trust Score scaffold response.
type Result struct {
	EntityType   string       `json:"entity_type"`
	EntityID     string       `json:"entity_id"`
	Score        int          `json:"score"`
	Grade        string       `json:"grade"`
	Tier         string       `json:"tier"`
	ModelVersion string       `json:"model_version"`
	Reasons      []ReasonCode `json:"reasons"`
	Limitations  []string     `json:"limitations"`
}

// Compute derives a FICO-style score from dossier signals with WOE reason codes.
// All outputs are tier=inferred until calibrated against deal outcomes.
func Compute(in Input) Result {
	var reasons []ReasonCode

	confWOE := (in.BaseConfidence - 50) * 0.6
	if confWOE != 0 {
		reasons = append(reasons, ReasonCode{
			Code: "BASE_CONF", Label: "Entity confidence baseline",
			WOE: confWOE, Impact: impactOf(confWOE), Tier: "inferred",
			Detail: strings.TrimSpace(in.DataQualityStatus),
		})
	}

	for _, s := range in.Signals {
		if rc, ok := signalReason(s); ok {
			reasons = append(reasons, rc)
		}
	}

	if in.EvidenceCount >= 5 {
		reasons = append(reasons, ReasonCode{
			Code: "EV_DEPTH_HIGH", Label: "Deep evidence chain",
			WOE: 35, Impact: "positive", Tier: "observed",
			Detail: itoa(in.EvidenceCount) + " claims",
		})
	} else if in.EvidenceCount == 0 {
		reasons = append(reasons, ReasonCode{
			Code: "EV_NONE", Label: "No linked evidence",
			WOE: -45, Impact: "negative", Tier: "missing",
		})
	}

	for _, rf := range in.RiskFlags {
		woe := -55.0
		if rf.Severity == "critical" || strings.Contains(strings.ToLower(rf.FlagType), "sanction") {
			woe = -120
		}
		reasons = append(reasons, ReasonCode{
			Code:  "RISK_" + strings.ToUpper(sanitizeCode(rf.FlagType)),
			Label: "Risk flag: " + humanize(rf.FlagType),
			WOE: woe, Impact: "negative", Tier: "observed",
		})
	}

	if in.RelationshipCount >= 3 {
		reasons = append(reasons, ReasonCode{
			Code: "GRAPH_RICH", Label: "Connected entity graph",
			WOE: 20, Impact: "positive", Tier: "inferred",
			Detail: itoa(in.RelationshipCount) + " relationships",
		})
	}

	switch strings.ToLower(in.DataQualityStatus) {
	case "high_risk", "conflicting":
		reasons = append(reasons, ReasonCode{
			Code:  "DQ_" + strings.ToUpper(in.DataQualityStatus),
			Label: "Data quality: " + humanize(in.DataQualityStatus),
			WOE: -40, Impact: "negative", Tier: "observed",
		})
	case "verified", "partially_verified":
		reasons = append(reasons, ReasonCode{
			Code:  "DQ_" + strings.ToUpper(in.DataQualityStatus),
			Label: "Data quality: " + humanize(in.DataQualityStatus),
			WOE: 25, Impact: "positive", Tier: "observed",
		})
	}

	sort.Slice(reasons, func(i, j int) bool {
		return math.Abs(reasons[i].WOE) > math.Abs(reasons[j].WOE)
	})
	if len(reasons) > 12 {
		reasons = reasons[:12]
	}

	raw := float64(BaseScore)
	for _, r := range reasons {
		raw += r.WOE
	}
	score := int(math.Round(clamp(raw, MinScore, MaxScore)))

	return Result{
		EntityType:   in.EntityType,
		EntityID:     in.EntityID,
		Score:        score,
		Grade:        gradeFor(score),
		Tier:         "inferred",
		ModelVersion: ModelVersion,
		Reasons:      reasons,
		Limitations: []string{
			"Scaffold scorecard — not calibrated to deal outcomes or credit bureau models",
			"WOE weights are heuristic; satellite-derived signals not included (Phase 12b deferred)",
			"Intelligence only — not legal, financial, or sanctions clearance",
		},
	}
}

func signalReason(s intelligence.EntitySignal) (ReasonCode, bool) {
	code := "SIG_" + strings.ToUpper(sanitizeCode(s.SignalType))
	tier := s.Tier
	if tier == "" {
		tier = "inferred"
	}
	switch s.SignalType {
	case "ais_freshness":
		if strings.Contains(s.Label, "fresh") {
			return ReasonCode{Code: code, Label: s.Label, WOE: 48, Impact: "positive", Tier: tier, Detail: s.Detail}, true
		}
		if strings.Contains(s.Label, "stale") {
			return ReasonCode{Code: code, Label: s.Label, WOE: -38, Impact: "negative", Tier: tier, Detail: s.Detail}, true
		}
		return ReasonCode{Code: code, Label: s.Label, WOE: 10, Impact: "positive", Tier: tier, Detail: s.Detail}, true
	case "ais_coverage":
		return ReasonCode{Code: code, Label: s.Label, WOE: -50, Impact: "negative", Tier: tier, Detail: s.Detail}, true
	case "evidence_depth":
		if s.Tier == "missing" {
			return ReasonCode{Code: code, Label: s.Label, WOE: -35, Impact: "negative", Tier: tier, Detail: s.Detail}, true
		}
		return ReasonCode{Code: code, Label: s.Label, WOE: 28, Impact: "positive", Tier: tier, Detail: s.Detail}, true
	case "supplier_tier":
		return ReasonCode{Code: code, Label: s.Label, WOE: 58, Impact: "positive", Tier: tier, Detail: s.Detail}, true
	case "reachability":
		return ReasonCode{Code: code, Label: s.Label, WOE: 22, Impact: "positive", Tier: tier, Detail: s.Detail}, true
	case "commodity_fit", "commodity":
		return ReasonCode{Code: code, Label: s.Label, WOE: 12, Impact: "positive", Tier: tier, Detail: s.Detail}, true
	case "coverage":
		return ReasonCode{Code: code, Label: s.Label, WOE: -18, Impact: "negative", Tier: tier, Detail: s.Detail}, true
	case "vertical":
		return ReasonCode{Code: code, Label: s.Label, WOE: 15, Impact: "positive", Tier: tier, Detail: s.Detail}, true
	default:
		if s.Score > 0 {
			woe := s.Score * 0.35
			return ReasonCode{Code: code, Label: s.Label, WOE: woe, Impact: impactOf(woe), Tier: tier, Detail: s.Detail}, true
		}
		return ReasonCode{Code: code, Label: s.Label, WOE: 0, Impact: "neutral", Tier: tier, Detail: s.Detail}, true
	}
}

func gradeFor(score int) string {
	switch {
	case score >= 650:
		return "strong"
	case score >= 550:
		return "good"
	case score >= 450:
		return "fair"
	default:
		return "low"
	}
}

func impactOf(woe float64) string {
	switch {
	case woe > 0:
		return "positive"
	case woe < 0:
		return "negative"
	default:
		return "neutral"
	}
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func sanitizeCode(s string) string {
	s = strings.ReplaceAll(s, " ", "_")
	return strings.ReplaceAll(s, "-", "_")
}

func humanize(s string) string {
	return strings.ReplaceAll(s, "_", " ")
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
