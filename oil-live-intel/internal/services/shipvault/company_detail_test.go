package shipvault

import "testing"

func TestParseCompanyDetail_fleetAggregates(t *testing.T) {
	t.Parallel()
	raw := map[string]any{"name": "Test Owner SA", "country": "GR"}
	fleet := []map[string]any{
		{"imo": "1111111", "name": "ALPHA", "tdw": 100000, "gt": 50000, "built": 2010},
		{"imo": "2222222", "name": "BETA", "tdw": 80000, "gt": 40000, "built": 2015},
	}
	c := parseCompanyDetail(raw, "99", fleet)
	if c == nil || c.FleetSize != 2 {
		t.Fatalf("fleet size = %d", c.FleetSize)
	}
	if c.TotalDWT != 180000 || c.TotalGT != 90000 {
		t.Fatalf("totals dwt=%v gt=%v", c.TotalDWT, c.TotalGT)
	}
	if c.AvgAgeYears <= 0 {
		t.Fatalf("avg age = %v", c.AvgAgeYears)
	}
}

func TestPickCompanySearchResult(t *testing.T) {
	t.Parallel()
	rows := []map[string]any{
		{"companyid": 100, "company1": "OTHER MARINE SA"},
		{"companyid": 32946, "company1": "ELETSON SA", "callname": "ELETSON"},
		{"companyid": 200, "company1": "ELETSON SHIPPING LTD"},
	}
	if got := pickCompanySearchResult(rows, "ELETSON"); got != "32946" {
		t.Fatalf("callname match id = %q, want 32946", got)
	}
	if got := pickCompanySearchResult(rows, "eletson ship"); got != "200" {
		t.Fatalf("partial match id = %q, want 200", got)
	}
	seaart := []map[string]any{{
		"companyid": 103731,
		"company1":  "SEAART MARITIME PVT LTD",
		"callname":  "SEAART MARITIME",
		"parent":    "SEAART MARITIME",
	}}
	if got := pickCompanySearchResult(seaart, "SEAART MARITIME"); got != "103731" {
		t.Fatalf("seaart id = %q, want 103731", got)
	}
	if got := pickCompanySearchResult([]map[string]any{{"companyid": "42"}}, "UNKNOWN"); got != "42" {
		t.Fatalf("fallback id = %q, want 42", got)
	}
}

func TestNormalizeCompanyName(t *testing.T) {
	t.Parallel()
	if got := normalizeCompanyName("SEAART MARITIME PVT LTD"); got != "SEAART MARITIME" {
		t.Fatalf("normalize = %q, want SEAART MARITIME", got)
	}
}

func TestParseFleetVessel_shipsearchShape(t *testing.T) {
	t.Parallel()
	row := map[string]any{
		"id": 120202, "imo": 9304605, "parentname": "MT MINERVA SYMPHONY",
		"groupname": "CRUDE OIL TANKER", "built": 2006, "tdw": 159450, "gt": 83722,
		"builder": "Hyundai Heavy",
	}
	v := ParseFleetVessel(row)
	if v.IMO != "9304605" || v.Name != "MT MINERVA SYMPHONY" {
		t.Fatalf("vessel = %#v", v)
	}
	if v.Type != "CRUDE OIL TANKER" || v.Built != 2006 || v.Yard != "Hyundai Heavy" {
		t.Fatalf("fields = %#v", v)
	}
}
