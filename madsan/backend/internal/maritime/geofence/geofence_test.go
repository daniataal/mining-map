package geofence_test

import (
	"testing"

	"github.com/madsan/intelligence/internal/maritime/geofence"
)

func TestInferProductFamilyCrude(t *testing.T) {
	got := geofence.InferProductFamily([]string{"crude_oil"}, "crude")
	if got != "crude_oil" {
		t.Fatalf("got %q", got)
	}
}

func TestInferProductFamilyRefined(t *testing.T) {
	got := geofence.InferProductFamily([]string{"diesel"}, "product")
	if got != "refined_products" {
		t.Fatalf("got %q", got)
	}
}
