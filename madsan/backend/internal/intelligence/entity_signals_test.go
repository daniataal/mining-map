package intelligence

import (
	"testing"
	"time"
)

func TestVesselSignalsFresh(t *testing.T) {
	ts := time.Now().Add(-2 * time.Hour)
	signals, opp := VesselSignals(&ts, nil, 55)
	if opp < 60 || len(signals) == 0 {
		t.Fatalf("expected fresh AIS boost, opp=%v signals=%d", opp, len(signals))
	}
}

func TestCompanySignalsRegister(t *testing.T) {
	signals, opp := CompanySignals(50, []EvidenceInput{
		{ClaimType: "register_tier", ClaimValue: "official_register", Tier: "observed"},
		{ClaimType: "phone", ClaimValue: "+123"},
	}, []string{"vlsfo"})
	if opp < 70 || len(signals) < 2 {
		t.Fatalf("opp=%v signals=%+v", opp, signals)
	}
}
