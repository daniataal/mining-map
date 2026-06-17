package markets

import "testing"

func TestGreatCircleDistanceNMRough(t *testing.T) {
	// Fujairah (~25.1, 56.3) to Singapore (~1.3, 103.8) ~3300–3600 nm
	nm := GreatCircleDistanceNM(25.1, 56.3, 1.3, 103.8)
	if nm < 3000 || nm > 4000 {
		t.Fatalf("distance nm = %.1f, expected ~3300-3600", nm)
	}
}

func TestEstimateFreightBandUSDPerBBL(t *testing.T) {
	band := EstimateFreightBandUSDPerBBL(25.1, 56.3, 1.3, 103.8, "VLCC")
	if band.Base <= band.Low || band.High <= band.Base {
		t.Fatalf("band ordering invalid: low=%.4f base=%.4f high=%.4f", band.Low, band.Base, band.High)
	}
	if band.Method != "great_circle_unctad_oecd_proxy" {
		t.Fatalf("method = %q", band.Method)
	}
}
