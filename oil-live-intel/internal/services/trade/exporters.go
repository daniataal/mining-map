package trade

// Exporter mirrors TOP_OIL_EXPORTERS from backend/ingest_oil_trades.py
type Exporter struct {
	Name string
	M49  string
	ISO2 string
}

var HSCodes = []string{"2709", "2710", "2711"}

var Exporters = []Exporter{
	{Name: "Saudi Arabia", M49: "682", ISO2: "SA"},
	{Name: "Russia", M49: "643", ISO2: "RU"},
	{Name: "United Arab Emirates", M49: "784", ISO2: "AE"},
	{Name: "Iraq", M49: "368", ISO2: "IQ"},
	{Name: "Canada", M49: "124", ISO2: "CA"},
	{Name: "Norway", M49: "578", ISO2: "NO"},
	{Name: "Kuwait", M49: "414", ISO2: "KW"},
	{Name: "United States", M49: "840", ISO2: "US"},
	{Name: "Kazakhstan", M49: "398", ISO2: "KZ"},
	{Name: "Nigeria", M49: "566", ISO2: "NG"},
	{Name: "Angola", M49: "024", ISO2: "AO"},
	{Name: "Algeria", M49: "012", ISO2: "DZ"},
	{Name: "Libya", M49: "434", ISO2: "LY"},
	{Name: "Mexico", M49: "484", ISO2: "MX"},
	{Name: "Azerbaijan", M49: "031", ISO2: "AZ"},
	{Name: "Netherlands", M49: "528", ISO2: "NL"},
	{Name: "India", M49: "356", ISO2: "IN"},
	{Name: "South Korea", M49: "410", ISO2: "KR"},
	{Name: "Singapore", M49: "702", ISO2: "SG"},
	{Name: "Belgium", M49: "056", ISO2: "BE"},
}

// EIA ISO3 subset from petroleum_trade.py
var EIAISO3 = map[string]string{
	"CA": "CAN", "US": "USA", "NO": "NOR", "RU": "RUS", "SA": "SAU",
	"AE": "ARE", "IQ": "IRQ", "KW": "KWT", "KZ": "KAZ", "NG": "NGA",
	"AO": "AGO", "DZ": "DZA", "LY": "LBY", "MX": "MEX", "AZ": "AZE",
	"NL": "NLD", "IN": "IND", "KR": "KOR", "SG": "SGP", "BE": "BEL",
	"GB": "GBR", "DE": "DEU", "FR": "FRA", "CN": "CHN",
}

var EIAProductByHS = map[string]string{
	"2709": "5",
	"2710": "57",
	"2711": "26",
}
