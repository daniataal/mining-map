package compliance

import (
	"embed"
	"encoding/json"
	"strings"
	"sync"
)

//go:embed data/dd_rules.json
var rulesFS embed.FS

type Rules struct {
	Version             string             `json:"_version"`
	SanctionedCountries []string           `json:"sanctioned_countries"`
	HighRiskCountries   []string           `json:"high_risk_countries"`
	EmbargoedCorridors  []EmbargoCorridor  `json:"embargoed_corridors"`
	CommodityRules      map[string]any     `json:"commodity_rules"`
	KYCThresholds       map[string]float64 `json:"kyc_thresholds"`
	Scoring             ScoringRules       `json:"scoring"`
}

type EmbargoCorridor struct {
	ID              string   `json:"id"`
	SupplierCountry string   `json:"supplier_country"`
	BuyerCountry    string   `json:"buyer_country"`
	Products        []string `json:"products"`
	Reason          string   `json:"reason"`
}

type CommodityRule struct {
	ConflictMinerals                   []string `json:"conflict_minerals"`
	ConflictMineralHighRiskCountries   []string `json:"conflict_mineral_high_risk_countries"`
	CertificationsAdvisory             []string `json:"certifications_advisory"`
	RequiredLicenseStatuses            []string `json:"required_license_statuses"`
	OffshoreExtraCheck                 bool     `json:"offshore_extra_check"`
	PipelineCheck                      bool     `json:"pipeline_check"`
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

// CommodityFamily maps deal commodities to dd_rules product families.
func CommodityRuleForFamily(rules Rules, family string) CommodityRule {
	raw, ok := rules.CommodityRules[family]
	if !ok {
		return CommodityRule{}
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return CommodityRule{}
	}
	var cr CommodityRule
	_ = json.Unmarshal(b, &cr)
	return cr
}

func isConflictMineral(commodity string, minerals []string) bool {
	c := strings.ToLower(strings.TrimSpace(commodity))
	for _, m := range minerals {
		if strings.Contains(c, strings.ToLower(strings.TrimSpace(m))) {
			return true
		}
	}
	return false
}

func CommodityFamily(commodity string) string {
	c := strings.ToLower(strings.TrimSpace(commodity))
	switch {
	case strings.Contains(c, "gold"), strings.Contains(c, "copper"), strings.Contains(c, "mine"):
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
