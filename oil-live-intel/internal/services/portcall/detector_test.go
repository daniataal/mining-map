package portcall

import "testing"

func TestBuildEvidenceIncludesDisclaimer(t *testing.T) {
	st := &visitState{TankerClass: "crude", HasDraftIn: true, HasDraftOut: true, DraftIn: 8, DraftOut: 14}
	ev := buildEvidence(st, 12, 8, 14, EventPossibleLoading, "crude_oil")
	found := false
	for _, e := range ev {
		if e == "Inferred from public AIS — not a confirmed private transaction" {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing disclaimer in %v", ev)
	}
}
