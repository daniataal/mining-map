package api

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type syncStatusSummary struct {
	TerminalCount         int     `json:"terminal_count"`
	CompanyCount          int     `json:"company_count"`
	CargoRecordCount      int     `json:"cargo_record_count"`
	PortCallCount         int     `json:"port_call_count"`
	OpenOpportunityCount  int     `json:"open_opportunity_count"`
	CorridorFullCount     int     `json:"corridor_full_count"`
	CorridorPartialCount  int     `json:"corridor_partial_count"`
	LastGraphSyncAt       any     `json:"last_graph_sync_at"`
	LastCargoAt           any     `json:"last_cargo_at"`
	Disclaimer            string  `json:"disclaimer"`
}

func querySyncStatus(ctx context.Context, pool *pgxpool.Pool) syncStatusSummary {
	var terminalCount, cargoCount, portCallCount, companyCount int
	var corridorFull, corridorPartial, openOpps int
	var lastGraphSync, lastCargoAt *time.Time

	_ = pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_terminals`).Scan(&terminalCount)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_companies`).Scan(&companyCount)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_port_calls`).Scan(&portCallCount)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM meridian_cargo_records`).Scan(&cargoCount)
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM meridian_cargo_records
		WHERE corridor_load_lat IS NOT NULL AND corridor_load_lng IS NOT NULL
		  AND corridor_discharge_lat IS NOT NULL AND corridor_discharge_lng IS NOT NULL
	`).Scan(&corridorFull)
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM meridian_cargo_records
		WHERE corridor_load_lat IS NOT NULL AND corridor_load_lng IS NOT NULL
		  AND (corridor_discharge_lat IS NULL OR corridor_discharge_lng IS NULL)
	`).Scan(&corridorPartial)
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM oil_opportunities WHERE status = 'open'
	`).Scan(&openOpps)
	_ = pool.QueryRow(ctx, `
		SELECT MAX(GREATEST(created_at, COALESCE(event_date, created_at)))
		FROM meridian_cargo_records
	`).Scan(&lastCargoAt)
	_ = pool.QueryRow(ctx, `
		SELECT value FROM oil_live_sync_state WHERE key = 'last_graph_sync_at'
	`).Scan(&lastGraphSync)

	return syncStatusSummary{
		TerminalCount:        terminalCount,
		CompanyCount:         companyCount,
		CargoRecordCount:     cargoCount,
		PortCallCount:        portCallCount,
		OpenOpportunityCount: openOpps,
		CorridorFullCount:    corridorFull,
		CorridorPartialCount: corridorPartial,
		LastGraphSyncAt:      formatTimePtr(lastGraphSync),
		LastCargoAt:          formatTimePtr(lastCargoAt),
		Disclaimer:           "Counts from Meridian DB — inferred tiers where noted.",
	}
}
