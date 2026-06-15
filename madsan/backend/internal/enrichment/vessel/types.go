package vessel

import "time"

// Enrichment is the normalized owner/operator cache row written by the ingestion job.
type Enrichment struct {
	MMSI              string
	IMO               string
	OwnerName         string
	OperatorName      string
	OwnerCompanyID    string // provider-side company id (e.g. ShipVault), not madsan UUID
	OperatorCompanyID string
	Builder           string
	BuildYear         *int
	VesselClass       string
	Flag              string
	GrossTonnage      *float64
	DeadweightTons    *float64
	FleetList         []any
	OwnerProfile      map[string]any
	Source            string
	Tier              string
	Confidence        float64
	Limitations       []string
	FetchedAt         time.Time
	StaleAfter        time.Time
	RawPayload        map[string]any
}

// Implemented reports whether the provider returned attributable registry facts.
func (e Enrichment) Implemented() bool {
	return e.Tier != "" && e.Tier != "not_implemented"
}
