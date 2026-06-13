package ingestion

import "testing"

func TestParseGEMEntityRefsPairsIDsAndShares(t *testing.T) {
	got := parseGEMEntityRefs(
		"INPEX Corp [65.0%]; PT Pertamina (Persero) [20.0%]",
		"E100000000638 [65.0%]; E100000000538 [20.0%]",
	)
	if len(got) != 2 {
		t.Fatalf("len=%d", len(got))
	}
	if got[0].ID != "E100000000638" || got[0].Name != "INPEX Corp" || got[0].SharePct == nil || *got[0].SharePct != 65 {
		t.Fatalf("first=%+v", got[0])
	}
	if got[1].ID != "E100000000538" || got[1].Name != "PT Pertamina (Persero)" || got[1].SharePct == nil || *got[1].SharePct != 20 {
		t.Fatalf("second=%+v", got[1])
	}
}

func TestSplitInvestorNamesDedupesAndSkipsUnavailable(t *testing.T) {
	got := splitInvestorNames("Abu Dhabi Investment Authority,Brookfield Asset Management, Not available; Brookfield Asset Management")
	if len(got) != 2 {
		t.Fatalf("got=%v", got)
	}
	if got[0] != "Abu Dhabi Investment Authority" || got[1] != "Brookfield Asset Management" {
		t.Fatalf("got=%v", got)
	}
}

func TestOilGasPECRRowFilter(t *testing.T) {
	if !isOilGasPECRRow(map[string]string{
		"Asset Energy Sector":  "Midstream",
		"Asset Energy Sources": "gas",
	}) {
		t.Fatal("expected gas midstream row")
	}
	if isOilGasPECRRow(map[string]string{
		"Company Energy Source": "Solar,Battery,Storage",
		"Asset Energy Sector":   "Renewable",
	}) {
		t.Fatal("renewable-only row should be excluded from oil/gas v1")
	}
}

func TestUniqueHeadersKeepsDuplicateCountry(t *testing.T) {
	got := uniqueHeaders([]string{"\ufeffCountry", "Project Name", "Country"})
	if got[0] != "Country" || got[2] != "Country#2" {
		t.Fatalf("headers=%v", got)
	}
}
