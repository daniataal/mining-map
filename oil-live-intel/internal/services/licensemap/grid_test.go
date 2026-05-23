package licensemap

import (
	"math"
	"testing"
)

func floatPtr(v float64) *float64 { return &v }

func TestGridDegreesLowZoom(t *testing.T) {
	if g := GridDegrees(floatPtr(2)); g == nil || *g != 16.0 {
		t.Fatalf("zoom 2: got %v", g)
	}
	if g := GridDegrees(floatPtr(3)); g == nil || *g != 12.0 {
		t.Fatalf("zoom 3: got %v", g)
	}
	if g := GridDegrees(floatPtr(4)); g == nil || *g != 8.0 {
		t.Fatalf("zoom 4: got %v", g)
	}
	if g := GridDegrees(floatPtr(5)); g == nil || *g != 6.0 {
		t.Fatalf("zoom 5: got %v", g)
	}
	if g := GridDegrees(floatPtr(6)); g == nil || *g != 6.0 {
		t.Fatalf("zoom 6: got %v", g)
	}
}

func TestGridDegreesDetailZoom(t *testing.T) {
	for _, z := range []float64{7, 8, 12} {
		if GridDegrees(floatPtr(z)) != nil {
			t.Fatalf("zoom %v should be nil", z)
		}
	}
	if GridDegrees(nil) != nil {
		t.Fatal("nil zoom should be nil grid")
	}
}

func TestClusterMinCount(t *testing.T) {
	if ClusterMinCount(1.5) != 2 {
		t.Fatal("1.5")
	}
	if ClusterMinCount(4.0) != 3 {
		t.Fatal("4.0")
	}
	if ClusterMinCount(12.0) != 4 {
		t.Fatal("12.0")
	}
}

func TestClusterLimitTighterAtWorldZoom(t *testing.T) {
	if ClusterLimitForZoom(floatPtr(2), 800) != 60 {
		t.Fatal("z2")
	}
	if ClusterLimitForZoom(floatPtr(4), 800) != 120 {
		t.Fatal("z4")
	}
	if ClusterLimitForZoom(floatPtr(10), 800) != 800 {
		t.Fatal("z10")
	}
}

func TestSimplifyToleranceIncreasesWhenZoomedOut(t *testing.T) {
	if SimplifyToleranceForZoom(floatPtr(12)) != 0 {
		t.Fatal("z12")
	}
	if SimplifyToleranceForZoom(floatPtr(10)) != 0 {
		t.Fatal("z10")
	}
	low := SimplifyToleranceForZoom(floatPtr(4))
	mid := SimplifyToleranceForZoom(floatPtr(7))
	if !(low > mid && mid > 0) {
		t.Fatalf("low=%v mid=%v", low, mid)
	}
	_ = math.Abs(low)
}
