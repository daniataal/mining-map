package compliance

import (
	"strings"
	"testing"
)

func TestParseSourceKeys(t *testing.T) {
	got := ParseSourceKeys(" EIA, global_fishing_watch ,eia ")
	if len(got) != 2 || got[0] != "eia" || got[1] != "global_fishing_watch" {
		t.Fatalf("got %v", got)
	}
}

func TestCommercialUseError(t *testing.T) {
	msg := CommercialUseError([]BlockedSource{{DisplayName: "Global Fishing Watch"}})
	if !strings.Contains(msg, "Global Fishing Watch") {
		t.Fatalf("msg=%q", msg)
	}
}
