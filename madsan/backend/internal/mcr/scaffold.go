package mcr

const (
	TierNotImplemented = "not_implemented"

	RecipeLikelyLoad        = "A_likely_load"
	RecipePortManifestMatch = "A_port_manifest_match"
	RecipeCorridor          = "B_corridor_trade"
	RecipeTenderBuyer       = "C_tender_buyer"
	RecipeSulfurBulk        = "D_sulfur_bulk"
	RecipeGovOfftake        = "E_gov_offtake"
	RecipeRepeatDealer      = "F_repeat_dealer"
	RecipeRefineryDriven    = "G_refinery_driven"

	ConfidenceMin = 0.35
	ConfidenceMax = 0.95

	LikelyLoadConfMultiplier = 0.95
	MinTriangulationScore    = 2
)

type RecipeConfidence struct {
	Recipe     string  `json:"recipe"`
	Confidence float64 `json:"confidence"`
	Variant    string  `json:"variant,omitempty"`
	Notes      string  `json:"notes,omitempty"`
}

type StatusResponse struct {
	Tier                  string             `json:"tier"`
	Status                string             `json:"status"`
	Message               string             `json:"message"`
	SourceEngine          string             `json:"source_engine"`
	ConfidenceBounds      map[string]float64 `json:"confidence_bounds"`
	MinTriangulationScore int                `json:"min_triangulation_score"`
	Recipes               []RecipeConfidence `json:"recipes"`
	Limitations           []string           `json:"limitations"`
}

func ClampConf(v float64) float64 {
	if v > ConfidenceMax {
		return ConfidenceMax
	}
	if v < ConfidenceMin {
		return ConfidenceMin
	}
	return v
}

func RecipeConfidences() []RecipeConfidence {
	return []RecipeConfidence{
		{Recipe: RecipeLikelyLoad, Confidence: LikelyLoadConfMultiplier, Notes: "multiplied by port_call confidence then clamped"},
		{Recipe: RecipePortManifestMatch, Confidence: 0.95, Notes: "direct manifest match"},
		{Recipe: RecipeCorridor, Confidence: 0.62, Variant: "base"},
		{Recipe: RecipeCorridor, Confidence: 0.78, Variant: "comtrade_corridor_match"},
		{Recipe: RecipeTenderBuyer, Confidence: 0.58},
		{Recipe: RecipeSulfurBulk, Confidence: 0.65, Variant: "port_call"},
		{Recipe: RecipeSulfurBulk, Confidence: 0.60, Variant: "terminal_only"},
		{Recipe: RecipeGovOfftake, Confidence: 0.55},
		{Recipe: RecipeRepeatDealer, Confidence: 0.72, Variant: "base"},
		{Recipe: RecipeRepeatDealer, Confidence: 0.78, Variant: "operator_contact_on_file"},
		{Recipe: RecipeRefineryDriven, Confidence: 0.70},
	}
}

func ScaffoldStatus() StatusResponse {
	return StatusResponse{
		Tier:         TierNotImplemented,
		Status:       "scaffold",
		Message:      "MCR v2 probabilistic log-odds engine not wired; additive recipe confidence constants ported from legacy syntheticbol",
		SourceEngine: "oil-live-intel/internal/services/syntheticbol/engine.go",
		ConfidenceBounds: map[string]float64{
			"min": ConfidenceMin,
			"max": ConfidenceMax,
		},
		MinTriangulationScore: MinTriangulationScore,
		Recipes:               RecipeConfidences(),
		Limitations: []string{
			"no voyage-based MCR generation",
			"no mass-balance or draught/TPC volume fusion",
			"no port_manifest calibration backtests",
			"recipes A-G not executed in madsan worker yet",
		},
	}
}
