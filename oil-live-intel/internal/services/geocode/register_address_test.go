package geocode

import "testing"

func TestParseRegisterAddressSingapore(t *testing.T) {
	p := ParseRegisterAddress(
		"7 Straits View #26-01 Marina One East Tower, Singapore 018936",
		"Singapore",
	)
	if p.Street != "7 Straits View" || p.PostalCode != "018936" {
		t.Fatalf("street/postal: %+v", p)
	}
	if p.Building != "Marina One East Tower" {
		t.Fatalf("building: %q", p.Building)
	}
	if !p.Structured {
		t.Fatal("expected structured query")
	}
}

func TestParseRegisterAddressNoUnit(t *testing.T) {
	p := ParseRegisterAddress("56 Tuas South Street 5, Singapore 637799", "Singapore")
	if p.Street != "56 Tuas South Street 5" || p.PostalCode != "637799" {
		t.Fatalf("parsed: %+v", p)
	}
}

func TestParseRegisterAddressSlashUnit(t *testing.T) {
	p := ParseRegisterAddress(
		"9 Straits View #12-07/12 Marina One West Tower, Singapore 018937",
		"Singapore",
	)
	if p.Building != "Marina One West Tower" {
		t.Fatalf("building: %q", p.Building)
	}
	queries := RegisterAddressFallbackQueries(p)
	if len(queries) < 2 || queries[0] != "9 Straits View, Singapore 018937" {
		t.Fatalf("fallback order: %v", queries)
	}
}
