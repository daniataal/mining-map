package graphsync

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mining-map/oil-live-intel/internal/datarepo"
)

func TestExpectedBunkerFuelSuppliersIndexed(t *testing.T) {
	path := datarepo.File("bunker_fuel_suppliers_seed.json")
	count, hubs, err := ExpectedBunkerFuelSuppliersIndexed(path)
	if err != nil {
		t.Fatalf("ExpectedBunkerFuelSuppliersIndexed: %v", err)
	}
	if count < 240 {
		t.Fatalf("expected >=240 suppliers, got %d", count)
	}
	if hubs < 10 {
		t.Fatalf("expected >=10 hubs, got %d", hubs)
	}
}

func TestIndexBunkerFuelSuppliersParityExpectedCount(t *testing.T) {
	dsn := os.Getenv("OILLIVE_TEST_DB")
	if dsn == "" {
		t.Skip("OILLIVE_TEST_DB not set")
	}
	t.Setenv("BUNKER_GEOCODE_DISABLED", "true")
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()

	path := datarepo.File("bunker_fuel_suppliers_seed.json")
	expected, _, err := ExpectedBunkerFuelSuppliersIndexed(path)
	if err != nil {
		t.Fatalf("expected: %v", err)
	}
	result, err := IndexBunkerFuelSuppliers(ctx, pool, path)
	if err != nil {
		t.Fatalf("IndexBunkerFuelSuppliers: %v", err)
	}
	if result.SuppliersIndexed != expected {
		t.Fatalf("suppliers_indexed parity: go=%d expected=%d", result.SuppliersIndexed, expected)
	}
}

func TestIndexBunkerFuelSuppliersIdempotent(t *testing.T) {
	dsn := os.Getenv("OILLIVE_TEST_DB")
	if dsn == "" {
		t.Skip("OILLIVE_TEST_DB not set")
	}
	t.Setenv("BUNKER_GEOCODE_DISABLED", "true")
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()

	path := datarepo.File("bunker_fuel_suppliers_seed.json")
	first, err := IndexBunkerFuelSuppliers(ctx, pool, path)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := IndexBunkerFuelSuppliers(ctx, pool, path)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if second.SuppliersIndexed < first.SuppliersIndexed {
		t.Fatalf("idempotent: first=%d second=%d", first.SuppliersIndexed, second.SuppliersIndexed)
	}
}
