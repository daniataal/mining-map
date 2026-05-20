package trade

import "testing"

func TestParseComtradeRow(t *testing.T) {
	row := map[string]any{
		"reporterDesc": "Saudi Arabia",
		"partnerDesc":  "World",
		"flowCode":     "X",
		"period":       "2022",
		"primaryValue": float64(1e9),
		"netWgt":       float64(2e9),
	}
	fr := parseComtradeRow(row, "682", "2709", 2022, "comtrade_public")
	if fr == nil || fr.FlowType != "X" || fr.HSCode != "2709" {
		t.Fatalf("unexpected row: %+v", fr)
	}
}
