package graphsync

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TerminalOperatorsResult mirrors the Python graph-sync step payload.
type TerminalOperatorsResult struct {
	OperatorsIndexed int `json:"operators_indexed"`
}

// ExpectedTerminalOperatorsIndexed counts upsertable distinct terminal operators using
// the same eligibility rules as backend/services/oil_live_graph_sync._index_terminal_operators.
func ExpectedTerminalOperatorsIndexed(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT DISTINCT TRIM(operator_name), COALESCE(country, '')
		FROM oil_terminals
		WHERE operator_name IS NOT NULL AND TRIM(operator_name) <> ''
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var operator, country string
		if err := rows.Scan(&operator, &country); err != nil {
			return 0, err
		}
		_ = country
		if len(strings.TrimSpace(operator)) < 2 {
			continue
		}
		if NormalizeName(operator) == "" {
			continue
		}
		count++
	}
	return count, rows.Err()
}

// IndexTerminalOperators ensures every distinct OSM terminal operator is in oil_companies.
// Idempotent — safe to re-run on every graph-sync tick.
func IndexTerminalOperators(ctx context.Context, pool *pgxpool.Pool) (TerminalOperatorsResult, error) {
	rows, err := pool.Query(ctx, `
		SELECT DISTINCT TRIM(operator_name), COALESCE(country, '')
		FROM oil_terminals
		WHERE operator_name IS NOT NULL AND TRIM(operator_name) <> ''
	`)
	if err != nil {
		return TerminalOperatorsResult{}, err
	}
	defer rows.Close()

	result := TerminalOperatorsResult{}
	for rows.Next() {
		var operator, country string
		if err := rows.Scan(&operator, &country); err != nil {
			return result, err
		}
		id, err := UpsertCompany(
			ctx, pool,
			operator, country,
			"terminal_operator", "osm_storage",
			0.58,
			map[string]any{"indexed_from": "oil_terminals"},
		)
		if err != nil {
			return result, err
		}
		if id != "" {
			result.OperatorsIndexed++
		}
	}
	return result, rows.Err()
}
