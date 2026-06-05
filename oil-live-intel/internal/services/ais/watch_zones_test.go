package ais

import "testing"

func TestMergeBoundingBoxesDedupes(t *testing.T) {
	a := BoundingBox{{1, 2}, {3, 4}}
	b := BoundingBox{{1, 2}, {3, 4}}
	c := BoundingBox{{5, 6}, {7, 8}}
	out := MergeBoundingBoxes([]BoundingBox{a}, []BoundingBox{b, c})
	if len(out) != 2 {
		t.Fatalf("expected 2 boxes, got %d", len(out))
	}
}
