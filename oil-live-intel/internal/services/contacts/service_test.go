package contacts

import "testing"

func TestNameMatches(t *testing.T) {
	if !nameMatches("Vopak", "Vopak Netherlands B.V.") {
		t.Fatal("expected substring match")
	}
	if nameMatches("AB", "CD") {
		t.Fatal("short names should not match")
	}
	if !nameMatches("Saudi Aramco", "saudi aramco trading") {
		t.Fatal("expected case-insensitive match")
	}
}

func TestNormalizeName(t *testing.T) {
	if normalizeName("Vopak B.V.") != "vopakbv" {
		t.Fatalf("got %q", normalizeName("Vopak B.V."))
	}
}
