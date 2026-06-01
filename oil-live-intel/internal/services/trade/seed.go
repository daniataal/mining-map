package trade

// seedFlows: curated 2022 export figures (m49, hs) -> USD value, kg weight
var seedFlows = map[string]struct {
	ValueUSD float64
	WeightKg float64
}{
	"682:2709": {326e9, 356e9},
	"643:2709": {210e9, 240e9},
	"784:2709": {157e9, 172e9},
	"368:2709": {113e9, 175e9},
	"124:2709": {102e9, 157e9},
	"578:2709": {89e9, 100e9},
	"414:2709": {74e9, 87e9},
	"840:2709": {60e9, 82e9},
	"398:2709": {48e9, 67e9},
	"566:2709": {45e9, 64e9},
	"024:2709": {38e9, 55e9},
	"012:2709": {31e9, 44e9},
	"484:2709": {27e9, 42e9},
	"434:2709": {26e9, 36e9},
	"031:2709": {19e9, 28e9},
	"840:2710": {149e9, 167e9},
	"643:2710": {79e9, 110e9},
	"356:2710": {72e9, 77e9},
	"528:2710": {66e9, 74e9},
	"702:2710": {63e9, 71e9},
	"682:2710": {55e9, 65e9},
	"410:2710": {54e9, 58e9},
	"784:2710": {48e9, 54e9},
	"056:2710": {40e9, 46e9},
	"124:2710": {35e9, 43e9},
	"124:2711": {18e9, 22e9},
	"682:2711": {15e9, 18e9},
	"643:2711": {52e9, 60e9},
	"578:2711": {20e9, 24e9},
}

// SeedRows returns static fallback rows for an exporter.
func SeedRows(exp Exporter, hs string) []FlowRow {
	key := exp.M49 + ":" + hs
	s, ok := seedFlows[key]
	if !ok {
		return nil
	}
	v, w := s.ValueUSD, s.WeightKg
	desc := "Petroleum"
	return []FlowRow{{
		Reporter:      exp.Name,
		ReporterM49:   exp.M49,
		ReporterISO2:  exp.ISO2,
		Partner:       "World",
		PartnerM49:    "0",
		HSCode:        hs,
		HSDescription: desc,
		FlowType:      "X",
		Year:          2022,
		TradeValueUSD: &v,
		NetWeightKg:   &w,
		DataSource:    "seed/static",
	}}
}
