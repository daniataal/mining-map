package trade

// FlowRow is one upsert-ready trade flow (Python oil_trade_flows schema).
type FlowRow struct {
	Source          string
	Reporter        string
	ReporterM49     string
	ReporterISO2    string
	Partner         string
	PartnerM49      string
	HSCode          string
	HSDescription   string
	FlowType        string // X | M
	Year            int
	TradeValueUSD   *float64
	NetWeightKg     *float64
	DataSource      string
}
