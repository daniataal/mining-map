package supplier

import "testing"

func TestMapCompanyType(t *testing.T) {
	if got := mapCompanyType("terminal_operator"); got != "oil_terminal_operator" {
		t.Fatalf("got %q", got)
	}
	if got := subCategory("storage_company"); got != "Storage" {
		t.Fatalf("got %q", got)
	}
}

func TestBuildPayloadForFrontend(t *testing.T) {
	p := BuildPayloadForFrontend(Company{
		Name: "Vopak", CompanyType: "storage_company", Country: "Netherlands",
	}, []string{"Rotterdam"})
	if p["category"] != "Oil & Energy" {
		t.Fatalf("unexpected payload: %v", p)
	}
}
