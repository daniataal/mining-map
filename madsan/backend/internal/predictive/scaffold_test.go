package predictive

import "testing"

func TestScaffoldStatusEmptyHonest(t *testing.T) {
	st := ScaffoldStatus()
	if st.Tier != TierNotImplemented || len(st.Signals) != 0 || len(st.SignalTypes) != 3 {
		t.Fatalf("unexpected scaffold: %+v", st)
	}
}
