package geofence

import "testing"

func TestMatchUsesGrid(t *testing.T) {
	idx := &Index{
		radiusM: 1200,
		terminals: []Terminal{
			{Name: "near", Lat: 51.0, Lon: 4.0},
			{Name: "far", Lat: 60.0, Lon: 10.0},
		},
	}
	idx.buildGrid()
	got := idx.Match(51.0001, 4.0001)
	if got == nil || got.Name != "near" {
		t.Fatalf("expected near terminal, got %#v", got)
	}
	if idx.Match(60.0, 10.0) == nil {
		t.Fatal("expected far terminal match at its coords")
	}
}
