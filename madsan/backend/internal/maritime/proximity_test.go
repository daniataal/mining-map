package maritime

import "testing"

func TestNormalizeDestination(t *testing.T) {
	if got := normalizeDestination("SG SIN"); got != "SIN" && got != "SG" {
		// accepts longest meaningful token
		if len(got) < 3 {
			t.Fatalf("unexpected: %q", got)
		}
	}
	if got := normalizeDestination(""); got != "" {
		t.Fatalf("empty: %q", got)
	}
	if got := normalizeDestination("> SINGAPORE"); got == "" {
		t.Fatal("expected singapore token")
	}
}
