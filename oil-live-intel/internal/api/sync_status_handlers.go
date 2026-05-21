package api

import (
	"net/http"
	"time"
)

// SyncStatus reports DB coverage counts and last graph-sync timestamp.
func (s *Server) SyncStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var terminalCount, cargoCount, portCallCount, companyCount int
	var corridorFull, corridorPartial int
	var lastGraphSync, lastCargoAt *time.Time

	_ = s.Pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_terminals`).Scan(&terminalCount)
	_ = s.Pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_companies`).Scan(&companyCount)
	_ = s.Pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_port_calls`).Scan(&portCallCount)
	_ = s.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM meridian_cargo_records
	`).Scan(&cargoCount)
	_ = s.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM meridian_cargo_records
		WHERE corridor_load_lat IS NOT NULL AND corridor_load_lng IS NOT NULL
		  AND corridor_discharge_lat IS NOT NULL AND corridor_discharge_lng IS NOT NULL
	`).Scan(&corridorFull)
	_ = s.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM meridian_cargo_records
		WHERE corridor_load_lat IS NOT NULL AND corridor_load_lng IS NOT NULL
		  AND (corridor_discharge_lat IS NULL OR corridor_discharge_lng IS NULL)
	`).Scan(&corridorPartial)
	_ = s.Pool.QueryRow(ctx, `
		SELECT MAX(GREATEST(created_at, COALESCE(event_date, created_at)))
		FROM meridian_cargo_records
	`).Scan(&lastCargoAt)
	_ = s.Pool.QueryRow(ctx, `
		SELECT value FROM oil_live_sync_state WHERE key = 'last_graph_sync_at'
	`).Scan(&lastGraphSync)

	out := map[string]any{
		"terminal_count":           terminalCount,
		"company_count":            companyCount,
		"cargo_record_count":       cargoCount,
		"port_call_count":          portCallCount,
		"corridor_full_count":      corridorFull,
		"corridor_partial_count":   corridorPartial,
		"last_graph_sync_at":       formatTimePtr(lastGraphSync),
		"last_cargo_at":            formatTimePtr(lastCargoAt),
		"disclaimer":               "Counts from Meridian DB — inferred tiers where noted.",
	}
	writeJSON(w, http.StatusOK, out)
}

func formatTimePtr(t *time.Time) any {
	if t == nil || t.IsZero() {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}
