package syntheticbol

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestInferCommodityFamily(t *testing.T) {
	crude := true
	if got := inferCommodityFamily([]string{"crude_oil"}, &crude, nil); got != "crude_oil" {
		t.Fatalf("expected crude_oil, got %s", got)
	}
	if got := inferCommodityFamily([]string{"sulfur"}, nil, nil); got != "sulfur" {
		t.Fatalf("expected sulfur, got %s", got)
	}
}

func TestFingerprintStable(t *testing.T) {
	a := fingerprint("A", "test")
	b := fingerprint("A", "test")
	if a != b || len(a) < 8 {
		t.Fatalf("unstable: %s %s", a, b)
	}
}

func TestCorridorFingerprintDistinct(t *testing.T) {
	exportPC := "11111111-1111-1111-1111-111111111111"
	importPC := "22222222-2222-2222-2222-222222222222"
	a := fingerprint(RecipeCorridor, exportPC, importPC)
	b := fingerprint(RecipeCorridor, exportPC, "33333333-3333-3333-3333-333333333333")
	if a == b {
		t.Fatal("corridor fingerprints should differ for different import port calls")
	}
}

func TestHsForFamily(t *testing.T) {
	if hsForFamily("crude_oil") != "2709" {
		t.Fatalf("crude hs")
	}
	if hsForFamily("sulfur") != "2802" {
		t.Fatalf("sulfur hs")
	}
}

func TestRecipeRefineryDrivenConstants(t *testing.T) {
	if RecipeRefineryDriven != "G_refinery_driven" {
		t.Fatalf("unexpected RecipeRefineryDriven constant: %q", RecipeRefineryDriven)
	}
	a := fingerprint(RecipeRefineryDriven, "11111111-1111-1111-1111-111111111111")
	b := fingerprint(RecipeRefineryDriven, "22222222-2222-2222-2222-222222222222")
	if a == b {
		t.Fatalf("refinery fingerprints should differ per terminal")
	}
}

// TestRecipeRefineryDrivenEmptyDB exercises the recipe against an empty / running
// Postgres reachable via OILLIVE_TEST_DB. With no matching refinery terminals the
// recipe must return no error and an empty slice; this guards against accidental
// nil-pool panics or invalid SQL when the migration ships.
func TestRecipeRefineryDrivenEmptyDB(t *testing.T) {
	dsn := os.Getenv("OILLIVE_TEST_DB")
	if dsn == "" {
		t.Skip("OILLIVE_TEST_DB not set; skipping DB-backed recipe smoke test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()
	drafts, err := recipeRefineryDriven(ctx, pool)
	if err != nil {
		t.Fatalf("recipeRefineryDriven returned error: %v", err)
	}
	if drafts == nil {
		drafts = []mcrDraft{}
	}
	t.Logf("recipeRefineryDriven returned %d drafts", len(drafts))
}
