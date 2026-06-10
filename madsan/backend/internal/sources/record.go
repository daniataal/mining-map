package sources

// Record is the adapter output shape; converted to ingestion.NormalizedRecord at import time.
type Record struct {
	EntityType  string
	Name        string
	CountryCode string
	Latitude    *float64
	Longitude   *float64
	Commodities []string
	AssetType   string
	RawPayload  map[string]any
	SourceSlug  string
	ExternalID  string
}
