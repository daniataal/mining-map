package contacts

import "testing"

func TestClassifyContactField(t *testing.T) {
	cases := map[string]string{
		"contact.phone":     "phone",
		"operator_email":    "email",
		"company.website":   "website",
		"registered_address": "address",
		"license_number":    "",
	}
	for path, want := range cases {
		if got := classifyContactField(path); got != want {
			t.Fatalf("%q: got %q want %q", path, got, want)
		}
	}
}

func TestIsValidContactValue(t *testing.T) {
	if !isValidContactValue("phone", "+1 555 123 4567") {
		t.Fatal("expected valid phone")
	}
	if isValidContactValue("phone", "abc") {
		t.Fatal("expected invalid phone")
	}
	if !isValidContactValue("email", "ops@example.com") {
		t.Fatal("expected valid email")
	}
}

func TestBuildLicenseContactCandidatesPhoneOnly(t *testing.T) {
	row := map[string]any{
		"id":            "lic-1",
		"phone_number":  "+44 20 7946 0958",
		"record_origin": "open_data",
		"source_name":   "UK Registry",
		"source_url":    "https://example.gov/license/1",
	}
	candidates := buildLicenseContactCandidates(row)
	if len(candidates) != 1 {
		t.Fatalf("got %d candidates want 1", len(candidates))
	}
	if candidates[0].ContactType != "phone" {
		t.Fatalf("contact type %q", candidates[0].ContactType)
	}
}

func TestBuildLicenseContactCandidatesSkipsWithoutSource(t *testing.T) {
	row := map[string]any{
		"id":           "lic-2",
		"phone_number": "+44 20 7946 0958",
	}
	if len(buildLicenseContactCandidates(row)) != 0 {
		t.Fatal("expected no candidates without reliable source")
	}
}

func TestContactFingerprintStable(t *testing.T) {
	a := contactFingerprint("license", "x", "phone", "123", "Src", "https://a")
	b := contactFingerprint("license", "x", "phone", "123", "Src", "https://a")
	if a != b || len(a) != 40 {
		t.Fatalf("fingerprint unstable: %q", a)
	}
}
