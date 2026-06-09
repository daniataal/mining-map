package compliance

import (
	"strings"
)

type DealContext struct {
	Commodity       string
	Seller          string
	Buyer           string
	SellerCountry   string
	BuyerCountry    string
	Location        string
	Quantity        float64
	PriceUSD        float64
	ClaimedVessel   string
}

type Check struct {
	Dimension string `json:"dimension"`
	Status    string `json:"status"`
	Message   string `json:"message"`
	Tier      string `json:"tier"`
}

type Evaluation struct {
	Checks         []Check `json:"checks"`
	ScoreDeduction float64 `json:"score_deduction"`
	Recommendation string  `json:"recommendation"`
	RulesVersion   string  `json:"rules_version,omitempty"`
}

func EvaluateDeal(ctx DealContext) (Evaluation, error) {
	rules, err := LoadRules()
	if err != nil {
		return Evaluation{}, err
	}
	var checks []Check
	deduction := 0.0
	family := CommodityFamily(ctx.Commodity)

	for _, party := range []struct {
		role, country string
	}{
		{"seller", ctx.SellerCountry},
		{"buyer", ctx.BuyerCountry},
	} {
		if party.country == "" {
			continue
		}
		if countryInList(party.country, rules.SanctionedCountries) {
			checks = append(checks, Check{
				Dimension: "sanctions",
				Status:    "fail",
				Message:   party.role + " country " + party.country + " is on sanctions watchlist (config)",
				Tier:      "observed",
			})
			deduction += rules.Scoring.FailDeduction
		} else if countryInList(party.country, rules.HighRiskCountries) {
			checks = append(checks, Check{
				Dimension: "sanctions",
				Status:    "warn",
				Message:   party.role + " country " + party.country + " is high-risk jurisdiction",
				Tier:      "observed",
			})
			deduction += rules.Scoring.WarnDeduction
		}
	}

	for _, emb := range rules.EmbargoedCorridors {
		if !corridorMatches(ctx.SellerCountry, emb.SupplierCountry) {
			continue
		}
		if !corridorMatches(ctx.BuyerCountry, emb.BuyerCountry) {
			continue
		}
		if !productMatches(family, emb.Products) {
			continue
		}
		checks = append(checks, Check{
			Dimension: "corridor",
			Status:    "fail",
			Message:   emb.Reason,
			Tier:      "observed",
		})
		deduction += rules.Scoring.FailDeduction
	}

	if ctx.Seller == "" || ctx.Buyer == "" {
		missing := []string{}
		if ctx.Seller == "" {
			missing = append(missing, "seller")
		}
		if ctx.Buyer == "" {
			missing = append(missing, "buyer")
		}
		checks = append(checks, Check{
			Dimension: "kyc",
			Status:    "warn",
			Message:   "Entity name(s) missing for: " + strings.Join(missing, ", ") + " — KYC screening incomplete",
			Tier:      "inferred",
		})
		deduction += rules.Scoring.WarnDeduction
	}

	if ctx.PriceUSD >= rules.KYCThresholds["enhanced_kyc_above_usd"] {
		checks = append(checks, Check{
			Dimension: "kyc",
			Status:    "warn",
			Message:   "Deal value exceeds enhanced KYC threshold — verify beneficial ownership",
			Tier:      "inferred",
		})
		deduction += rules.Scoring.WarnDeduction
	} else if ctx.PriceUSD == 0 {
		checks = append(checks, Check{
			Dimension: "kyc",
			Status:    "warn",
			Message:   "Transaction value not provided — defaulting to enhanced-KYC posture",
			Tier:      "inferred",
		})
		deduction += rules.Scoring.WarnDeduction
	}

	for _, c := range commodityChecks(ctx, rules, family) {
		checks = append(checks, c)
		switch c.Status {
		case "fail":
			deduction += rules.Scoring.FailDeduction
		case "warn":
			deduction += rules.Scoring.WarnDeduction
		}
	}

	if ctx.Quantity > 50000 && (family == "oil" || family == "petroleum" || family == "gas") {
		checks = append(checks, Check{
			Dimension: "logistics",
			Status:    "warn",
			Message:   "Large energy quantity — confirm terminal/storage capacity at " + ctx.Location,
			Tier:      "inferred",
		})
		deduction += rules.Scoring.WarnDeduction
	}

	rec := "approve"
	for _, c := range checks {
		if c.Status == "fail" {
			rec = "block"
			break
		}
	}
	if rec != "block" {
		for _, c := range checks {
			if c.Status == "warn" {
				rec = "review"
			}
		}
	}

	return Evaluation{
		Checks:         checks,
		ScoreDeduction: deduction,
		Recommendation: rec,
		RulesVersion:   rules.Version,
	}, nil
}

func commodityChecks(ctx DealContext, rules Rules, family string) []Check {
	cr := CommodityRuleForFamily(rules, family)
	var checks []Check

	if len(cr.ConflictMinerals) > 0 {
		if ctx.Commodity == "" {
			checks = append(checks, Check{
				Dimension: "commodity",
				Status:    "warn",
				Message:   "Commodity not specified — cannot perform conflict-mineral screening",
				Tier:      "inferred",
			})
		} else if isConflictMineral(ctx.Commodity, cr.ConflictMinerals) {
			if countryInList(ctx.SellerCountry, cr.ConflictMineralHighRiskCountries) {
				checks = append(checks, Check{
					Dimension: "commodity",
					Status:    "fail",
					Message:   ctx.Commodity + " is a potential conflict mineral from high-risk origin " + ctx.SellerCountry + " — OECD/ICGLR certification required",
					Tier:      "observed",
				})
			} else {
				checks = append(checks, Check{
					Dimension: "commodity",
					Status:    "warn",
					Message:   ctx.Commodity + " is listed as a potential conflict mineral — provenance documentation recommended",
					Tier:      "inferred",
				})
			}
		}
	}

	if cr.OffshoreExtraCheck {
		checks = append(checks, Check{
			Dimension: "commodity",
			Status:    "warn",
			Message:   "Oil/petroleum route flagged for offshore-field extra check — confirm field classification and permits",
			Tier:      "inferred",
		})
	}
	if cr.PipelineCheck {
		checks = append(checks, Check{
			Dimension: "commodity",
			Status:    "warn",
			Message:   "Gas route may involve cross-border pipeline transit — verify transit-country agreements",
			Tier:      "inferred",
		})
	}
	if len(cr.CertificationsAdvisory) > 0 {
		checks = append(checks, Check{
			Dimension: "commodity",
			Status:    "pass",
			Message:   "Advisory: consider verifying " + strings.Join(cr.CertificationsAdvisory, ", ") + " certification for " + family + " trades",
			Tier:      "inferred",
		})
	}
	return checks
}

func EnergyMissingDocuments(commodity string) []string {
	c := strings.ToLower(commodity)
	base := []string{"Tank storage receipt", "Terminal operator confirmation", "SGS/Intertek quality certificate"}
	switch {
	case strings.Contains(c, "vlsfo"), strings.Contains(c, "hsfo"), strings.Contains(c, "mgo"):
		return append(base, "Bunker delivery note", "ISO 8217 spec sheet")
	case strings.Contains(c, "en590"), strings.Contains(c, "diesel"):
		return append(base, "CN code / customs classification", "Product specification EN590")
	case strings.Contains(c, "crude"):
		return append(base, "Bill of lading", "Assay certificate")
	default:
		return base
	}
}

// MissingDocuments is the energy commodity document checklist (legacy alias).
func MissingDocuments(commodity string) []string {
	return EnergyMissingDocuments(commodity)
}
