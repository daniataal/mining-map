package intelligence

import (
	"strings"
	"testing"
)

func TestScoreSTSProbabilityOffshoreZoneHigh(t *testing.T) {
	res := ScoreSTSProbability(STSProbabilityInput{
		MinDistanceM: 120, DurationHours: 5, AvgSOG: 0.3,
		BothTankers: true, InSTSZone: true, ZoneName: "Fujairah STS anchorage",
		DistanceVarianceM: 40,
	})
	if res.TransferProbability < 75 || res.ReviewTier != "high" {
		t.Fatalf("expected high offshore probability, got %.0f %s", res.TransferProbability, res.ReviewTier)
	}
	if res.ProximityScore <= res.TransferProbability-15 {
		t.Fatalf("proximity should remain visible, got prox %.0f transfer %.0f", res.ProximityScore, res.TransferProbability)
	}
}

func TestScoreSTSProbabilityPortAnchorageDowngrades(t *testing.T) {
	res := ScoreSTSProbability(STSProbabilityInput{
		MinDistanceM: 120, DurationHours: 6, AvgSOG: 0.2,
		BothTankers: true, MaritimeContextType: "anchorage", MaritimeContextName: "Southampton anchorage",
		MaritimeContextDistanceM: 500, NearestTerminalName: "Southampton", NearestTerminalDistanceM: 2200,
	})
	if res.TransferProbability >= 55 || res.ReviewTier == "high" {
		t.Fatalf("expected port anchorage downgrade, got %.0f %s", res.TransferProbability, res.ReviewTier)
	}
	if len(res.DowngradeReasons) == 0 {
		t.Fatal("expected downgrade reasons")
	}
}

func TestScoreSTSProbabilityPortCallsDowngradeHard(t *testing.T) {
	res := ScoreSTSProbability(STSProbabilityInput{
		MinDistanceM: 90, DurationHours: 7, AvgSOG: 0.1,
		BothTankers: true, OverlappingPortCalls: 2,
	})
	if res.TransferProbability >= 45 {
		t.Fatalf("expected hard port-call downgrade, got %.0f", res.TransferProbability)
	}
}

func TestScoreSTSProbabilityCrowdingDowngrades(t *testing.T) {
	res := ScoreSTSProbability(STSProbabilityInput{
		MinDistanceM: 150, DurationHours: 4, AvgSOG: 0.4,
		BothTankers: true, CrowdingVesselCount: 14,
	})
	if res.TransferProbability >= res.ProximityScore {
		t.Fatalf("expected crowding to reduce transfer probability: prox %.0f transfer %.0f", res.ProximityScore, res.TransferProbability)
	}
}

func TestScoreSTSProbabilitySpoofClusterKillsScore(t *testing.T) {
	// Perfect proximity signal, but 6 vessels stacked at one point = GPS spoofing.
	res := ScoreSTSProbability(STSProbabilityInput{
		MinDistanceM: 10, DurationHours: 8, AvgSOG: 0,
		BothTankers: true, InSTSZone: true, ZoneName: "spoofed",
		SpoofClusterVessels: 6,
	})
	if res.TransferProbability > 12 {
		t.Fatalf("expected spoof cluster to cap probability at 12, got %.0f", res.TransferProbability)
	}
	if res.ContextLabel != "GPS interference suspected" {
		t.Fatalf("expected GPS interference label, got %q", res.ContextLabel)
	}
	if res.CargoConfidence > 15 {
		t.Fatalf("expected cargo confidence capped, got %.0f", res.CargoConfidence)
	}
	if res.ReviewTier != "low" {
		t.Fatalf("expected low review tier, got %s", res.ReviewTier)
	}
}

func TestScoreSTSProbabilityPositionOnLandKillsScore(t *testing.T) {
	res := ScoreSTSProbability(STSProbabilityInput{
		MinDistanceM: 10, DurationHours: 8, AvgSOG: 0,
		BothTankers: true, InSTSZone: true, ZoneName: "spoofed",
		PositionOnLand: true,
	})
	if res.TransferProbability > 10 {
		t.Fatalf("expected on-land position to cap probability at 10, got %.0f", res.TransferProbability)
	}
	if res.ContextLabel != "position over land" {
		t.Fatalf("expected position over land label, got %q", res.ContextLabel)
	}
}

func TestScoreSTSProbabilityStackedNearPortIsRaftingNotSpoof(t *testing.T) {
	res := ScoreSTSProbability(STSProbabilityInput{
		MinDistanceM: 30, DurationHours: 6, AvgSOG: 0.1,
		BothTankers: true, SpoofClusterVessels: 5,
		MaritimeContextType: "port", MaritimeContextName: "Amsterdam", MaritimeContextDistanceM: 800,
	})
	if res.ContextLabel == "GPS interference suspected" {
		t.Fatal("stacking next to a port should be rafting, not GPS interference")
	}
	found := false
	for _, r := range res.DowngradeReasons {
		if strings.Contains(r, "rafting") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected rafting downgrade reason, got %v", res.DowngradeReasons)
	}
}

func TestScoreSTSProbabilityPartnerDegreeDowngrades(t *testing.T) {
	base := ScoreSTSProbability(STSProbabilityInput{
		MinDistanceM: 100, DurationHours: 5, AvgSOG: 0.3, BothTankers: true,
	})
	flagged := ScoreSTSProbability(STSProbabilityInput{
		MinDistanceM: 100, DurationHours: 5, AvgSOG: 0.3, BothTankers: true,
		PartnerDegree: 6,
	})
	if flagged.TransferProbability >= base.TransferProbability {
		t.Fatalf("expected partner-degree downgrade: base %.0f flagged %.0f", base.TransferProbability, flagged.TransferProbability)
	}
}

func TestScoreSTSProbabilityMixedClassesReduceCargoOnly(t *testing.T) {
	pure := ScoreSTSProbability(STSProbabilityInput{
		MinDistanceM: 100, DurationHours: 5, AvgSOG: 0.3, BothTankers: true,
	})
	mixed := ScoreSTSProbability(STSProbabilityInput{
		MinDistanceM: 100, DurationHours: 5, AvgSOG: 0.3, BothTankers: true,
		MixedTankerClasses: true,
	})
	if mixed.CargoConfidence >= pure.CargoConfidence {
		t.Fatalf("expected mixed classes to reduce cargo confidence: pure %.0f mixed %.0f", pure.CargoConfidence, mixed.CargoConfidence)
	}
}
