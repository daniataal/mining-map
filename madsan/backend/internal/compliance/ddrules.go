package compliance

import (
	"embed"
	"encoding/json"
	"strings"
	"sync"
)

//go:embed data/dd_rules.json
var rulesFS embed.FS

// Rules mirrors backend/data/dd_rules.json — single source for deal verification DD checks.
type Rules struct {
	Version             string                   `json:"_version"`
	SanctionedCountries []string                 `json:"sanctioned_countries"`
	HighRiskCountries   []string                 `json:"high_risk_countries"`
	EmbargoedCorridors  []EmbargoCorridor        `json:"embargoed_corridors"`
	CommodityRules      map[string]CommodityRule `json:"commodity_rules"`
	KYCThresholds       map[string]float64       `json:"kyc_thresholds"`
	Scoring             ScoringRules             `json:"scoring"`
}

type EmbargoCorridor struct {
	ID              string   `json:"id"`
	SupplierCountry string   `json:"supplier_country"`
	BuyerCountry    string   `json:"buyer_country"`
	Products        []string `json:"products"`
	Reason          string   `json:"reason"`
}

type CommodityRule struct {
	ConflictMinerals                 []string `json:"conflict_minerals"`
	ConflictMineralHighRiskCountries []string `json:"conflict_mineral_high_risk_countries"`
	CertificationsAdvisory           []string `json:"certifications_advisory"`
	RequiredLicenseStatuses          []string `json:"required_license_statuses"`
	OffshoreExtraCheck               bool     `json:"offshore_extra_check"`
	PipelineCheck                    bool     `json:"pipeline_check"`
	Note                             string   `json:"note"`
}

type ScoringRules struct {
	FailDeduction    float64 `json:"fail_deduction"`
	WarnDeduction    float64 `json:"warn_deduction"`
	ApproveThreshold float64 `json:"approve_threshold"`
	BlockThreshold   float64 `json:"block_threshold"`
}

var (
	rulesOnce sync.Once
	rules     Rules
	rulesErr  error
)

// LoadRules reads the embedded dd_rules.json once (parity with Python _load_rules).
func LoadRules() (Rules, error) {
	rulesOnce.Do(func() {
		b, err := rulesFS.ReadFile("data/dd_rules.json")
		if err != nil {
			rulesErr = err
			return
		}
		rulesErr = json.Unmarshal(b, &rules)
	})
	return rules, rulesErr
}

// CommodityRuleForFamily returns typed commodity rules for a product family key.
func CommodityRuleForFamily(rules Rules, family string) CommodityRule {
	if rules.CommodityRules == nil {
		return CommodityRule{}
	}
	if r, ok := rules.CommodityRules[family]; ok {
		return r
	}
	return CommodityRule{}
}

func normCountry(s string) string {
	return strings.TrimSpace(strings.ToLower(s))
}

func countryInList(country string, list []string) bool {
	c := normCountry(country)
	for _, item := range list {
		if normCountry(item) == c {
			return true
		}
	}
	return false
}

func productMatches(product string, ruleProducts []string) bool {
	p := strings.TrimSpace(strings.ToLower(product))
	for _, rp := range ruleProducts {
		rp = strings.TrimSpace(rp)
		if rp == "*" || strings.ToLower(rp) == p {
			return true
		}
	}
	return false
}

func corridorMatches(country, pattern string) bool {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" || pattern == "*" {
		return true
	}
	return normCountry(country) == normCountry(pattern)
}

func isConflictMineral(commodity string, minerals []string) bool {
	c := strings.TrimSpace(strings.ToLower(commodity))
	for _, m := range minerals {
		if strings.TrimSpace(strings.ToLower(m)) == c {
			return true
		}
	}
	return false
}

// CommodityFamily maps deal commodities to dd_rules product families.
func CommodityFamily(commodity string) string {
	c := strings.ToLower(strings.TrimSpace(commodity))
	switch {
	case strings.Contains(c, "gold"), strings.Contains(c, "copper"), strings.Contains(c, "mine"),
		strings.Contains(c, "coltan"), strings.Contains(c, "cobalt"), strings.Contains(c, "diamond"):
		return "mining"
	case strings.Contains(c, "gas"), strings.Contains(c, "lng"):
		return "gas"
	case strings.Contains(c, "vlsfo"), strings.Contains(c, "hsfo"), strings.Contains(c, "mgo"),
		strings.Contains(c, "en590"), strings.Contains(c, "diesel"), strings.Contains(c, "fuel"),
		strings.Contains(c, "crude"), strings.Contains(c, "jet"), strings.Contains(c, "petroleum"),
		strings.Contains(c, "oil"):
		return "oil"
	default:
		return "petroleum"
	}
}
