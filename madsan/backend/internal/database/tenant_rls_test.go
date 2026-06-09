package database

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestTenantIDContextRoundTrip(t *testing.T) {
	tid := uuid.New()
	ctx := WithTenantID(context.Background(), tid)
	got, ok := TenantIDFromContext(ctx)
	if !ok {
		t.Fatal("expected tenant id in context")
	}
	if got != tid {
		t.Fatalf("tenant id = %v, want %v", got, tid)
	}
}

func TestTenantIDFromContextEmpty(t *testing.T) {
	if _, ok := TenantIDFromContext(context.Background()); ok {
		t.Fatal("expected no tenant id in bare context")
	}
}

func TestBindRequestTenantRLSNilPool(t *testing.T) {
	tid := uuid.New()
	ctx, release, err := BindRequestTenantRLS(context.Background(), nil, tid)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	release()
	got, ok := TenantIDFromContext(ctx)
	if !ok || got != tid {
		t.Fatalf("nil pool should still set tenant context: got=%v ok=%v", got, ok)
	}
}

func TestBindRequestTenantRLSNilTenant(t *testing.T) {
	ctx, release, err := BindRequestTenantRLS(context.Background(), nil, uuid.Nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	release()
	if _, ok := TenantIDFromContext(ctx); ok {
		t.Fatal("nil tenant should not set context")
	}
}
