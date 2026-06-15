package ingestion

import "testing"

func TestParseGEMOwnershipList(t *testing.T) {
	got := parseGEMOwnershipList("TotalEnergies SE [43.2%]; BlueNord ASA [36.8%]; Nordsøfonden A/S [20.0%]")
	if len(got) != 3 {
		t.Fatalf("len=%d", len(got))
	}
	if got[0].Name != "TotalEnergies SE" || got[0].SharePct == nil || *got[0].SharePct != 43.2 {
		t.Fatalf("first=%+v", got[0])
	}
	if got[2].Name != "Nordsøfonden A/S" || got[2].SharePct == nil || *got[2].SharePct != 20.0 {
		t.Fatalf("third=%+v", got[2])
	}
}

func TestGEMProductCode(t *testing.T) {
	cases := map[string]string{
		"oil":        "CRUDEOIL",
		"liquids":    "CRUDEOIL",
		"gas":        "GAS",
		"NGL":        "NGL",
		"condensate": "CONDENSATE",
	}
	for input, want := range cases {
		if got := gemProductCode(input); got != want {
			t.Fatalf("gemProductCode(%q)=%q want %q", input, got, want)
		}
	}
}

func TestGEMEntityID(t *testing.T) {
	if got := gemEntityID("TotalEnergies SE"); got != "gem:name:totalenergies-se" {
		t.Fatalf("entity id=%q", got)
	}
}
