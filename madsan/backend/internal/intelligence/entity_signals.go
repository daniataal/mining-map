package intelligence

import (
	"strconv"
	"strings"
	"time"
)

type EntitySignal struct {
	SignalType string  `json:"signal_type"`
	Label      string  `json:"label"`
	Score      float64 `json:"score,omitempty"`
	Tier       string  `json:"tier"`
	Detail     string  `json:"detail,omitempty"`
}

type EvidenceInput struct {
	ClaimType  string
	ClaimValue string
	Tier       string
}

func VesselSignals(lastSeen *time.Time, speed *float64, confidence float64) ([]EntitySignal, float64) {
	var signals []EntitySignal
	opp := confidence
	if lastSeen == nil {
		signals = append(signals, EntitySignal{
			SignalType: "ais_coverage", Label: "No AIS timestamp", Tier: "missing",
			Detail: "Position may be registry-only",
		})
		opp -= 15
	} else {
		age := time.Since(*lastSeen)
		if age < 24*time.Hour {
			signals = append(signals, EntitySignal{
				SignalType: "ais_freshness", Label: "AIS fresh (<24h)", Tier: "observed", Score: 85,
			})
			opp += 10
		} else if age < 72*time.Hour {
			signals = append(signals, EntitySignal{
				SignalType: "ais_freshness", Label: "AIS recent (<72h)", Tier: "observed", Score: 60,
			})
		} else {
			signals = append(signals, EntitySignal{
				SignalType: "ais_freshness", Label: "AIS stale (>72h)", Tier: "inferred", Score: 25,
				Detail: "Limited live tracking confidence",
			})
			opp -= 10
		}
	}
	if speed != nil && *speed < 1 {
		signals = append(signals, EntitySignal{
			SignalType: "vessel_state", Label: "Likely anchored", Tier: "observed",
		})
	}
	return signals, clampScore(opp)
}

func AssetSignals(assetType string, confidence float64, evidenceCount int, commodities []string) ([]EntitySignal, float64) {
	opp := confidence
	signals := []EntitySignal{{
		SignalType: "asset_class", Label: humanAssetType(assetType), Tier: "observed",
	}}
	if evidenceCount >= 3 {
		signals = append(signals, EntitySignal{
			SignalType: "evidence_depth", Label: "Multi-claim evidence", Tier: "observed", Score: 70,
			Detail: strconv.Itoa(evidenceCount) + " provenance claims",
		})
		opp += 8
	} else if evidenceCount == 0 {
		signals = append(signals, EntitySignal{
			SignalType: "evidence_depth", Label: "No evidence chain", Tier: "missing",
		})
		opp -= 12
	}
	if len(commodities) > 0 {
		signals = append(signals, EntitySignal{
			SignalType: "commodity", Label: "Commodity: " + strings.Join(commodities, ", "), Tier: "observed",
		})
		opp += 5
	}
	if assetType == "mine" {
		signals = append(signals, EntitySignal{
			SignalType: "vertical", Label: "Mining license cadastre", Tier: "observed",
		})
		opp += 5
	}
	return signals, clampScore(opp)
}

// SupplierDiscoveryTier is an honest evidence tier for supplier search ranking (not deal verification).
func SupplierDiscoveryTier(confidence float64, evidenceCount int) string {
	switch {
	case evidenceCount >= 5:
		return "observed"
	case evidenceCount >= 1 || confidence >= 50:
		return "inferred"
	default:
		return "missing"
	}
}

func CompanySignals(confidence float64, evidence []EvidenceInput, commodities []string) ([]EntitySignal, float64) {
	opp := confidence
	var signals []EntitySignal
	hasRegister := false
	hasContact := false
	for _, e := range evidence {
		switch e.ClaimType {
		case "register_tier":
			if e.ClaimValue == "official_register" {
				hasRegister = true
			}
		case "phone", "email":
			hasContact = true
		case "source_url":
			if strings.Contains(e.ClaimValue, ".gov") {
				hasRegister = true
			}
		}
	}
	if hasRegister {
		signals = append(signals, EntitySignal{
			SignalType: "supplier_tier", Label: "Government register tier", Tier: "observed", Score: 80,
		})
		opp += 15
	}
	if hasContact {
		signals = append(signals, EntitySignal{
			SignalType: "reachability", Label: "Contact channels on file", Tier: "observed",
		})
		opp += 8
	}
	if len(evidence) >= 5 {
		signals = append(signals, EntitySignal{
			SignalType: "evidence_depth", Label: "Rich evidence chain", Tier: "observed",
			Detail: strconv.Itoa(len(evidence)) + " claims",
		})
		opp += 5
	}
	if len(commodities) > 0 {
		signals = append(signals, EntitySignal{
			SignalType: "commodity_fit", Label: "Supplies: " + strings.Join(commodities, ", "), Tier: "observed",
		})
		opp += 5
	}
	if len(signals) == 0 {
		signals = append(signals, EntitySignal{
			SignalType: "coverage", Label: "Limited supplier evidence", Tier: "inferred",
		})
	}
	return signals, clampScore(opp)
}

func humanAssetType(t string) string {
	switch t {
	case "tank_farm":
		return "Tank farm / storage"
	case "mine":
		return "Mining license"
	case "refinery":
		return "Refinery"
	default:
		return strings.ReplaceAll(t, "_", " ")
	}
}

func clampScore(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}
