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
	case strings.Contains(c, "fuel oil"), strings.Contains(c, "ifo"), strings.Contains(c, "hfo") && !strings.Contains(c, "vlsfo"):
		return append(base, "Bill of lading", "ISO 8217 marine fuel spec", "Vessel nomination")
	case strings.Contains(c, "jet"), strings.Contains(c, "aviation"), strings.Contains(c, "kerosene"):
		return append(base, "DEF STAN / Jet A-1 spec sheet", "Into-plane delivery ticket", "Airport fuel farm release")
	default:
		return base
	}
}

func MetalsMissingDocuments(commodity string) []string {
	c := strings.ToLower(commodity)
	base := []string{
		"Assay certificate (accredited lab)",
		"Certificate of origin",
		"KYC/AML beneficial ownership disclosure",
	}
	switch {
	case strings.Contains(c, "gold"):
		return append(base, "LBMA good delivery certificate", "Refinery license", "Export permit")
	case strings.Contains(c, "copper"), strings.Contains(c, "cathode"):
		return append(base, "Warehouse warrant", "Purity / cathode brand certificate")
	case strings.Contains(c, "silver"):
		return append(base, "LBMA silver delivery standard", "Vault receipt")
	default:
		return append(base, "Mining license or concession evidence")
	}
}

// DealMissingDocuments returns the commodity-appropriate document checklist.
func DealMissingDocuments(commodity string) []string {
	if CommodityFamily(commodity) == "mining" {
		return MetalsMissingDocuments(commodity)
	}
	return EnergyMissingDocuments(commodity)
}

// RecommendedQuestions returns broker DD prompts tailored to commodity and terms.
func RecommendedQuestions(commodity, incoterm, location string) []string {
	family := CommodityFamily(commodity)
	c := strings.ToLower(strings.TrimSpace(commodity))
	if family == "mining" {
		qs := []string{
			"Request assay from accredited lab on stamped sample",
			"Verify export license and chain-of-custody to refinery",
		}
		if strings.Contains(c, "gold") {
			qs = append(qs, "Confirm LBMA refinery status and good-delivery bar list")
		}
		if strings.Contains(c, "copper") {
			qs = append(qs, "Confirm cathode brand and warehouse warrant validity")
		}
		return qs
	}
	qs := []string{
		"Request tank storage receipt",
		"Request terminal operator confirmation",
		"Ask for product origin/refinery proof",
	}
	switch {
	case strings.Contains(c, "vlsfo"), strings.Contains(c, "mgo"), strings.Contains(c, "hsfo"):
		qs = append(qs, "Confirm ISO 8217 parameters and sulphur cap compliance")
	case strings.Contains(c, "en590"), strings.Contains(c, "diesel"):
		qs = append(qs, "Confirm EN590 winter grade and sulphur content for destination")
	case strings.Contains(c, "crude"):
		qs = append(qs, "Request dated assay and loading port nomination")
	case strings.Contains(c, "jet"), strings.Contains(c, "aviation"):
		qs = append(qs, "Confirm Jet A-1 freeze point and DEF STAN compliance")
	case strings.Contains(c, "fuel oil"):
		qs = append(qs, "Confirm viscosity/COT and bunker or port delivery mechanism")
	}
	inc := strings.ToUpper(strings.TrimSpace(incoterm))
	if inc == "FOB" || inc == "FCA" {
		qs = append(qs, "Who arranges and pays for marine survey at load port?")
	}
	if location != "" {
		qs = append(qs, "Can seller provide terminal/storage title at "+location+"?")
	}
	return qs
}

// MissingDocuments is the energy commodity document checklist (legacy alias).
func MissingDocuments(commodity string) []string {
	return EnergyMissingDocuments(commodity)
}
