package intelligence

import (
	"fmt"
	"math"
	"strings"
)

// STSProbabilityInput fuses AIS proximity with maritime context.
type STSProbabilityInput struct {
	MinDistanceM             float64
	DurationHours            float64
	AvgSOG                   float64
	DistanceVarianceM        float64
	BothTankers              bool
	InSTSZone                bool
	ZoneName                 string
	MaritimeContextType      string
	MaritimeContextName      string
	MaritimeContextDistanceM float64
	NearestTerminalName      string
	NearestTerminalDistanceM float64
	OverlappingPortCalls     int
	CrowdingVesselCount      int
	// SpoofClusterVessels is the number of distinct vessels reporting
	// near-identical positions at the event point (incl. the pair). Tankers are
	// 100-300 m long, so 4+ hulls stacked inside ~150 m is physically
	// impossible — it is the signature of GPS jamming/spoofing (common in the
	// Eastern Mediterranean and Gulf), which teleports unrelated vessels to one
	// fixed point and fabricates proximity events.
	SpoofClusterVessels int
	// PartnerDegree is the max number of distinct STS partners either vessel
	// had in the lookback window. Very high degree means either an AIS anomaly
	// or a lightering hub — both deserve review, not a confident event.
	PartnerDegree int
	// MixedTankerClasses is true when both classes are known but belong to
	// different cargo families (e.g. crude vs product).
	MixedTankerClasses bool
	// PositionOnLand is true when the event point falls on a land polygon with
	// no inland waterway (river/lake) nearby. Vessels cannot be there; the
	// position is GPS interference or corrupt AIS data.
	PositionOnLand bool
}

// STSProbabilityResult is the map/user-facing interpretation of an STS signal.
type STSProbabilityResult struct {
	ProximityScore      float64          `json:"proximity_score"`
	TransferProbability float64          `json:"transfer_probability"`
	CargoConfidence     float64          `json:"cargo_confidence"`
	ContextLabel        string           `json:"context_label"`
	ReviewTier          string           `json:"review_tier"`
	Factors             []STSScoreFactor `json:"factors"`
	DowngradeReasons    []string         `json:"downgrade_reasons,omitempty"`
	Limitations         []string         `json:"limitations,omitempty"`
	Disclaimer          string           `json:"disclaimer"`
}

// ScoreSTSProbability keeps proximity separate from transfer probability.
func ScoreSTSProbability(in STSProbabilityInput) STSProbabilityResult {
	prox := ScoreSTS(STSScoreInput{
		MinDistanceM:     in.MinDistanceM,
		DurationHours:    in.DurationHours,
		AvgSOG:           in.AvgSOG,
		DistanceVariance: in.DistanceVarianceM,
		BothTankers:      in.BothTankers,
		InSTSZone:        in.InSTSZone,
		OutsideTerminal:  true,
		ZoneName:         in.ZoneName,
	})

	transfer := prox.Score
	contextLabel := "open water"
	factors := make([]STSScoreFactor, 0, 8)
	reasons := []string{}

	addFactor := func(name string, weight, score float64, detail string) {
		factors = append(factors, STSScoreFactor{
			Name: name, Weight: weight, Score: clamp01(score), Weighted: clamp01(score) * weight, Detail: detail,
		})
	}

	addFactor("ais_proximity", 0.30, prox.Score/100, fmt.Sprintf("AIS proximity score %.0f", prox.Score))

	if in.InSTSZone {
		boost := 0.08
		if in.MinDistanceM <= 200 && in.DurationHours >= 4 {
			transfer += 8
			boost = 0.16
		}
		contextLabel = "offshore STS zone"
		addFactor("sts_zone", 0.16, boost/0.16, stsZoneDetail(true, in.ZoneName))
	} else {
		addFactor("sts_zone", 0.10, 0.25, "outside known STS zone")
	}

	ctxType := strings.ToLower(strings.TrimSpace(in.MaritimeContextType))
	if ctxType != "" {
		contextLabel = contextLabelFromMaritimeContext(ctxType)
		score := 0.5
		detail := fmt.Sprintf("nearest %s %.1f km", contextLabel, in.MaritimeContextDistanceM/1000)
		if in.MaritimeContextName != "" {
			detail = fmt.Sprintf("%s %.1f km", in.MaritimeContextName, in.MaritimeContextDistanceM/1000)
		}
		switch {
		case isPortAnchorageContext(ctxType) && !in.InSTSZone:
			transfer -= 35
			score = 0.15
			reasons = append(reasons, "inside or near port/anchorage context")
		case isPortAnchorageContext(ctxType):
			transfer -= 10
			score = 0.55
			reasons = append(reasons, "STS zone overlaps anchorage/port context")
		}
		addFactor("port_anchorage_context", 0.16, score, detail)
	}

	if in.NearestTerminalDistanceM > 0 {
		score := 1.0
		detail := fmt.Sprintf("nearest petroleum facility %.1f km", in.NearestTerminalDistanceM/1000)
		if in.NearestTerminalName != "" {
			detail = fmt.Sprintf("%s %.1f km", in.NearestTerminalName, in.NearestTerminalDistanceM/1000)
		}
		switch {
		case in.NearestTerminalDistanceM <= 1200:
			transfer -= 35
			score = 0.05
			contextLabel = "terminal edge"
			reasons = append(reasons, "centroid within terminal/facility buffer")
		case in.NearestTerminalDistanceM <= 5000 && !in.InSTSZone:
			transfer -= 22
			score = 0.35
			if contextLabel == "open water" {
				contextLabel = "terminal edge"
			}
			reasons = append(reasons, "near petroleum terminal/facility")
		case in.NearestTerminalDistanceM <= 15000 && !in.InSTSZone:
			transfer -= 8
			score = 0.70
		}
		addFactor("oil_terminal_context", 0.12, score, detail)
	}

	if in.OverlappingPortCalls > 0 {
		penalty := 30.0
		if in.OverlappingPortCalls >= 2 {
			penalty = 52
		}
		transfer -= penalty
		contextLabel = "port-call overlap"
		reasons = append(reasons, "vessel port-call overlap during proximity")
		addFactor("port_call_overlap", 0.16, math.Max(0, 1-penalty/52), fmt.Sprintf("%d vessel(s) had overlapping port calls", in.OverlappingPortCalls))
	} else {
		addFactor("port_call_overlap", 0.08, 1, "no overlapping port-call visit matched")
	}

	if in.CrowdingVesselCount > 0 {
		score := 1.0
		switch {
		case in.CrowdingVesselCount >= 12:
			transfer -= 18
			score = 0.25
			reasons = append(reasons, "dense vessel crowding near candidate")
		case in.CrowdingVesselCount >= 6:
			transfer -= 10
			score = 0.55
			reasons = append(reasons, "anchorage-like vessel crowding")
		case in.CrowdingVesselCount >= 3:
			transfer -= 5
			score = 0.75
		}
		addFactor("crowding", 0.10, score, fmt.Sprintf("%d other vessel(s) within 1 km", in.CrowdingVesselCount))
	}

	if in.DistanceVarianceM > 0 {
		score := 1.0
		switch {
		case in.DistanceVarianceM <= 60:
			transfer += 4
		case in.DistanceVarianceM <= 150:
			score = 0.65
		default:
			transfer -= 8
			score = 0.35
			reasons = append(reasons, "separation was not stable")
		}
		addFactor("distance_stability", 0.10, score, fmt.Sprintf("separation stddev %.0f m", in.DistanceVarianceM))
	}

	// Vessel berths and moorings sit at the land/water edge, so position
	// stacking next to port infrastructure is usually barge rafting, not GPS
	// spoofing; away from any infrastructure it can only be spoofing.
	// Land polygons (Natural Earth 10m) do not carve out dock/harbor basins, so
	// "on land" next to petroleum infrastructure is a port basin with real
	// vessels; "on land" away from everything can only be GPS interference.
	// Likewise position stacking near port infrastructure is barge rafting,
	// while stacking in the middle of nowhere is a spoofing anchor point.
	inPortBasin := (in.NearestTerminalDistanceM > 0 && in.NearestTerminalDistanceM <= 10000) ||
		(isPortAnchorageContext(ctxType) && in.MaritimeContextDistanceM <= 5000)
	stacked := in.SpoofClusterVessels >= 4
	spoofed := (in.PositionOnLand || stacked) && !inPortBasin
	switch {
	case in.PositionOnLand && !inPortBasin:
		transfer = math.Min(transfer, 10)
		contextLabel = "position over land"
		reasons = append(reasons, "reported position is over land, away from ports and waterways — GPS interference or corrupt AIS data, location unreliable")
		addFactor("gps_integrity", 0.20, 0, "event point on land")
	case in.PositionOnLand:
		transfer -= 30
		contextLabel = "dock/harbor basin"
		reasons = append(reasons, "position inside a dock/harbor basin — in-port mooring or cargo operations, not offshore STS")
		addFactor("dock_basin", 0.12, 0.15, "event point in port dock basin")
	case stacked && !inPortBasin:
		transfer = math.Min(transfer, 12)
		contextLabel = "GPS interference suspected"
		reasons = append(reasons, fmt.Sprintf("%d vessels reporting near-identical positions away from any port — GPS jamming/spoofing signature, location unreliable", in.SpoofClusterVessels))
		addFactor("gps_integrity", 0.20, 0, fmt.Sprintf("%d vessels stacked at one point", in.SpoofClusterVessels))
	case stacked:
		transfer -= 20
		reasons = append(reasons, fmt.Sprintf("%d vessels stacked at mooring — likely barge rafting or berth congestion, not offshore STS", in.SpoofClusterVessels))
		addFactor("mooring_stack", 0.10, 0.2, fmt.Sprintf("%d vessels rafted at berth/mooring", in.SpoofClusterVessels))
	case in.PartnerDegree >= 4:
		transfer -= 25
		reasons = append(reasons, fmt.Sprintf("vessel paired with %d different partners in window — AIS anomaly or crowded hub", in.PartnerDegree))
		addFactor("pair_degree", 0.10, 0.25, fmt.Sprintf("max partner degree %d", in.PartnerDegree))
	}

	cargo := 20.0
	if in.BothTankers {
		cargo += 45
	}
	if in.MixedTankerClasses {
		cargo -= 15
		reasons = append(reasons, "mixed tanker classes (crude vs product) — atypical pairing, product unconfirmed")
	}
	if in.InSTSZone {
		cargo += 10
	}
	if in.NearestTerminalDistanceM > 0 && in.NearestTerminalDistanceM <= 15000 {
		cargo += 8
	}
	if transfer < 35 {
		cargo = math.Min(cargo, 45)
	}
	if spoofed {
		cargo = math.Min(cargo, 15)
	}

	transfer = clamp100(transfer)
	cargo = clamp100(cargo)

	return STSProbabilityResult{
		ProximityScore:      prox.Score,
		TransferProbability: transfer,
		CargoConfidence:     cargo,
		ContextLabel:        contextLabel,
		ReviewTier:          stsReviewTier(transfer, reasons),
		Factors:             factors,
		DowngradeReasons:    reasons,
		Limitations: []string{
			"AIS does not confirm cargo transfer or title change",
			"Port/anchorage context is inferred from open-source geospatial layers",
			"Cargo/product confidence is inferred from vessel class and nearby infrastructure",
		},
		Disclaimer: "STS transfer probability is an AIS + context inference, not a confirmed commodity transfer",
	}
}

func isPortAnchorageContext(t string) bool {
	switch t {
	case "anchorage", "port", "harbour", "harbor", "berth", "port_group":
		return true
	default:
		return strings.Contains(t, "anchorage") || strings.Contains(t, "port")
	}
}

func contextLabelFromMaritimeContext(t string) string {
	if strings.Contains(t, "anchorage") {
		return "port anchorage"
	}
	if strings.Contains(t, "berth") {
		return "berth area"
	}
	if strings.Contains(t, "harbour") || strings.Contains(t, "harbor") || strings.Contains(t, "port") {
		return "port area"
	}
	return t
}

func stsReviewTier(score float64, reasons []string) string {
	switch {
	case score < 35:
		return "low"
	case len(reasons) > 0:
		return "review"
	case score >= 75 && len(reasons) == 0:
		return "high"
	case score >= 60:
		return "medium"
	case score >= 35:
		return "review"
	default:
		return "low"
	}
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func clamp100(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return math.Round(v)
}
