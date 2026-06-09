package maritime

import "testing"

func TestInBBox(t *testing.T) {
	bbox := [4]float64{50, 20, 60, 30}
	if !InBBox(25, 55, bbox) {
		t.Fatal("expected inside")
	}
	if InBBox(10, 55, bbox) {
		t.Fatal("expected outside south")
	}
	if InBBox(25, 70, bbox) {
		t.Fatal("expected outside east")
	}
}
