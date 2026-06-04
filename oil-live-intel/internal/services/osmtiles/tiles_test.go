package osmtiles

import "testing"

func TestClampTileCoords(t *testing.T) {
	z, x, y, err := ClampTileCoords("pipelines", 20, -1, 99999)
	if err != nil {
		t.Fatal(err)
	}
	maxTile := (1 << MaxZoom) - 1
	if z != MaxZoom {
		t.Fatalf("z=%d want %d", z, MaxZoom)
	}
	if x != 0 || y != maxTile {
		t.Fatalf("x=%d y=%d want x=0 y=%d", x, y, maxTile)
	}
}

func TestClampTileCoordsUnknownLayer(t *testing.T) {
	_, _, _, err := ClampTileCoords("power_lines", 10, 1, 1)
	if err == nil {
		t.Fatal("expected error for unknown layer")
	}
}

func TestMinZoomForLayer(t *testing.T) {
	if MinZoomForLayer("pipelines") != PipelineMinZ {
		t.Fatalf("pipelines min z")
	}
	if MinZoomForLayer("refineries") != MinZoom {
		t.Fatalf("refineries min z")
	}
}
