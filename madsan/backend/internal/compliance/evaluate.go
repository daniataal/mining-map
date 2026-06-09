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

	if ctx.PriceUSD >= rules.KYCThresholds["enhanced_kyc_above_usd"] {
		checks = append(checks, Check{
			Dimension: "kyc",
			Status:    "warn",
			Message:   "Deal value exceeds enhanced KYC threshold — verify beneficial ownership",
			Tier:      "inferred",
		})
		deduction += rules.Scoring.WarnDeduction
	}

	if ctx.Quantity > 50000 && family == "oil" {
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

	return Evaluation{Checks: checks, ScoreDeduction: deduction, Recommendation: rec}, nil
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
