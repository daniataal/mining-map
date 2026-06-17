package ais_test

import (
	"testing"

	"github.com/madsan/intelligence/internal/maritime/ais"
)

func TestBuildTerminalBoxesSingleEnvelope(t *testing.T) {
	lats := []float64{10, 50, -40}
	lons := []float64{20, 100, -170}
	boxes := ais.BuildTerminalBoxes(lats, lons, 0.45)
	if len(boxes) != 1 {
		t.Fatalf("expected 1 merged box, got %d", len(boxes))
	}
	b := boxes[0]
	if b[0][0] != -40.45 || b[1][0] != 50.45 {
		t.Fatalf("lat envelope: got [%f,%f]", b[0][0], b[1][0])
	}
	if b[0][1] != -170.45 || b[1][1] != 100.45 {
		t.Fatalf("lon envelope: got [%f,%f]", b[0][1], b[1][1])
	}
}

func TestMergeBoundingBoxesDedupes(t *testing.T) {
	a := []ais.BoundingBox{{{0, 0}, {1, 1}}}
	b := []ais.BoundingBox{{{0, 0}, {1, 1}}, {{10, 10}, {11, 11}}}
	merged := ais.MergeBoundingBoxes(a, b)
	if len(merged) != 2 {
		t.Fatalf("expected 2 boxes after dedupe, got %d", len(merged))
	}
}
