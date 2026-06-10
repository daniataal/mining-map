package entitlements

import (
	"context"
	"testing"
)

func TestCanGrantsMapPremiumLayersInDev(t *testing.T) {
	r := New(nil, true)
	ok, err := r.Can(context.Background(), nil, nil, "map_premium_layers")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected dev grant for map_premium_layers")
	}
}

func TestCanDoesNotGrantOtherFeaturesInDev(t *testing.T) {
	r := New(nil, true)
	ok, err := r.Can(context.Background(), nil, nil, "deal_verification")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("dev grant must not bypass unrelated features")
	}
}

func TestCanNilTenantWithoutDevGrant(t *testing.T) {
	r := New(nil, false)
	ok, err := r.Can(context.Background(), nil, nil, "map_premium_layers")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("expected false without tenant and dev grant")
	}
}
