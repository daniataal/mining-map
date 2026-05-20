package syntheticbol

import "testing"

func TestParseDestinationCountry(t *testing.T) {
	cases := []struct {
		dest string
		want string
	}{
		{"SG SIN", "Singapore"},
		{"ROTTERDAM", "Netherlands"},
		{"FOR ORDERS", ""},
		{"", ""},
		{"FUJAIRAH ANCH", "United Arab Emirates"},
		{"HOUSTON TX", "United States"},
	}
	for _, tc := range cases {
		got := parseDestinationCountry(tc.dest)
		if got != tc.want {
			t.Fatalf("parseDestinationCountry(%q) = %q, want %q", tc.dest, got, tc.want)
		}
	}
}

func TestNormalizeDestination(t *testing.T) {
	if got := normalizeDestination("  FOR ORDERS  "); got != "" {
		t.Fatalf("expected empty for FOR ORDERS, got %q", got)
	}
	if got := normalizeDestination("SG SIN"); got != "SG SIN" {
		t.Fatalf("expected SG SIN, got %q", got)
	}
}
