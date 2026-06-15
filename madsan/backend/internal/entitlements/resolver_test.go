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

func TestCheckGrantsMapPremiumLayersInDev(t *testing.T) {
	r := New(nil, true)
	status, err := r.Check(context.Background(), nil, nil, "map_premium_layers", 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !status.Allowed || status.Reason != "dev_grant" {
		t.Fatalf("status=%+v", status)
	}
}

func TestCheckNilTenantWithoutDevGrant(t *testing.T) {
	r := New(nil, false)
	status, err := r.Check(context.Background(), nil, nil, "supplier_discovery", 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status.Allowed || status.Reason != "missing_tenant" {
		t.Fatalf("status=%+v", status)
	}
}
