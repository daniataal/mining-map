package shipvault

import "testing"

func TestParseBootstrapBody(t *testing.T) {
	t.Parallel()
	rt, err := ParseBootstrapBody("direct-rt", "")
	if err != nil || rt != "direct-rt" {
		t.Fatalf("direct: rt=%q err=%v", rt, err)
	}
	raw := `{"idToken":"jwt","refreshToken":"from-session","expiresIn":"3600"}`
	rt, err = ParseBootstrapBody("", raw)
	if err != nil || rt != "from-session" {
		t.Fatalf("session: rt=%q err=%v", rt, err)
	}
	_, err = ParseBootstrapBody("", "")
	if err == nil {
		t.Fatal("expected error for empty body")
	}
}
