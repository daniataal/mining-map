package api

import (
	"github.com/madsan/intelligence/internal/intelligence"
)

func evidenceInputs(claims []EvidenceClaim) []intelligence.EvidenceInput {
	out := make([]intelligence.EvidenceInput, len(claims))
	for i, c := range claims {
		out[i] = intelligence.EvidenceInput{
			ClaimType: c.ClaimType, ClaimValue: c.ClaimValue, Tier: c.Tier,
		}
	}
	return out
}

func attachAssetSignals(resp *CoreEntityResponse, assetType string, commodities []string) {
	signals, opp := intelligence.AssetSignals(assetType, resp.Confidence.Score, len(resp.Evidence), commodities)
	resp.Signals = toAPISignals(signals)
	resp.OpportunityScore = &opp
}

func attachCompanySignals(resp *CoreEntityResponse, commodities []string) {
	signals, opp := intelligence.CompanySignals(resp.Confidence.Score, evidenceInputs(resp.Evidence), commodities)
	resp.Signals = toAPISignals(signals)
	resp.OpportunityScore = &opp
}

func toAPISignals(in []intelligence.EntitySignal) []EntitySignal {
	out := make([]EntitySignal, len(in))
	for i, s := range in {
		out[i] = EntitySignal{
			SignalType: s.SignalType, Label: s.Label, Score: s.Score, Tier: s.Tier, Detail: s.Detail,
		}
	}
	return out
}
