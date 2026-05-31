package graphsync

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestIndexTerminalOperatorsParityExpectedCount(t *testing.T) {
	dsn := os.Getenv("OILLIVE_TEST_DB")
	if dsn == "" {
		t.Skip("OILLIVE_TEST_DB not set; skipping DB-backed graph-sync parity test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()

	expected, err := ExpectedTerminalOperatorsIndexed(ctx, pool)
	if err != nil {
		t.Fatalf("ExpectedTerminalOperatorsIndexed: %v", err)
	}
	result, err := IndexTerminalOperators(ctx, pool)
	if err != nil {
		t.Fatalf("IndexTerminalOperators: %v", err)
	}
	if result.OperatorsIndexed != expected {
		t.Fatalf("operators_indexed parity: go=%d expected=%d (Python _index_terminal_operators logic)",
			result.OperatorsIndexed, expected)
	}
	t.Logf("parity ok: operators_indexed=%d", result.OperatorsIndexed)
}

func TestIndexTerminalOperatorsEmptyDB(t *testing.T) {
	dsn := os.Getenv("OILLIVE_TEST_DB")
	if dsn == "" {
		t.Skip("OILLIVE_TEST_DB not set; skipping DB-backed graph-sync parity test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()

	result, err := IndexTerminalOperators(ctx, pool)
	if err != nil {
		t.Fatalf("IndexTerminalOperators: %v", err)
	}
	if result.OperatorsIndexed < 0 {
		t.Fatalf("unexpected operators_indexed: %d", result.OperatorsIndexed)
	}
	t.Logf("operators_indexed=%d", result.OperatorsIndexed)
}

func TestIndexTerminalOperatorsIdempotentFixture(t *testing.T) {
	dsn := os.Getenv("OILLIVE_TEST_DB")
	if dsn == "" {
		t.Skip("OILLIVE_TEST_DB not set; skipping DB-backed graph-sync parity test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()

	const fixtureName = "GraphSync Parity Terminal Op"
	const fixtureCountry = "ZZ-GraphSync-Test"

	_, err = pool.Exec(ctx, `
		INSERT INTO oil_terminals (name, operator_name, country, terminal_type, source, geom)
		VALUES ($1, $2, $3, 'storage', 'graphsync_parity_test', ST_SetSRID(ST_MakePoint(0, 0), 4326))
	`, fixtureName, fixtureName, fixtureCountry)
	if err != nil {
		t.Fatalf("insert fixture terminal: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `
			DELETE FROM oil_terminals WHERE operator_name = $1 AND country = $2 AND source = 'graphsync_parity_test'
		`, fixtureName, fixtureCountry)
		_, _ = pool.Exec(context.Background(), `
			DELETE FROM oil_companies WHERE normalized_name = $1 AND country = $2
		`, NormalizeName(fixtureName), fixtureCountry)
	})

	first, err := IndexTerminalOperators(ctx, pool)
	if err != nil {
		t.Fatalf("first IndexTerminalOperators: %v", err)
	}
	second, err := IndexTerminalOperators(ctx, pool)
	if err != nil {
		t.Fatalf("second IndexTerminalOperators: %v", err)
	}
	if first.OperatorsIndexed < 1 {
		t.Fatalf("expected at least one indexed operator, got %d", first.OperatorsIndexed)
	}
	if second.OperatorsIndexed < first.OperatorsIndexed {
		t.Fatalf("idempotent run should not reduce count: first=%d second=%d", first.OperatorsIndexed, second.OperatorsIndexed)
	}

	var companyType string
	err = pool.QueryRow(ctx, `
		SELECT company_type FROM oil_companies
		WHERE normalized_name = $1 AND country = $2
	`, NormalizeName(fixtureName), fixtureCountry).Scan(&companyType)
	if err != nil {
		t.Fatalf("lookup company: %v", err)
	}
	if companyType != "terminal_operator" {
		t.Fatalf("company_type: got %q want terminal_operator", companyType)
	}
}
