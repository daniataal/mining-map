package api

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TopCorridor is a single row in the sync-status `top_corridors` digest.
// All four fields come from the mcr_corridor_aggregates_country view.
type TopCorridor struct {
	ShipperCountry   string `json:"shipper_country"`
	ConsigneeCountry string `json:"consignee_country"`
	CommodityFamily  string `json:"commodity_family"`
	CargoCount       int    `json:"cargo_count"`
}

type syncStatusSummary struct {
	TerminalCount                 int           `json:"terminal_count"`
	CompanyCount                  int           `json:"company_count"`
	CargoRecordCount              int           `json:"cargo_record_count"`
	PortCallCount                 int           `json:"port_call_count"`
	OpenOpportunityCount          int           `json:"open_opportunity_count"`
	CorridorFullCount             int           `json:"corridor_full_count"`
	CorridorPartialCount          int           `json:"corridor_partial_count"`
	McrWithLeiCount               int           `json:"mcr_with_lei_count"`
	McrWithSanctionsScreenedCount int           `json:"mcr_with_sanctions_screened_count"`
	McrCorridorCompanyPairCount   int           `json:"mcr_corridor_company_pair_count"`
	TopCorridors                  []TopCorridor `json:"top_corridors"`
	LastGraphSyncAt               any           `json:"last_graph_sync_at"`
	LastCargoAt                   any           `json:"last_cargo_at"`
	Disclaimer                    string        `json:"disclaimer"`
}

func querySyncStatus(ctx context.Context, pool *pgxpool.Pool) syncStatusSummary {
	var terminalCount, cargoCount, portCallCount, companyCount int
	var corridorFull, corridorPartial, openOpps int
	var mcrWithLEI, mcrWithSanctions, mcrCorridorCompanyPairs int
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

	// Enrichment counters from migration 013 — silently 0 if columns are missing.
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM meridian_cargo_records
		WHERE shipper_lei IS NOT NULL OR consignee_lei IS NOT NULL
	`).Scan(&mcrWithLEI)
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM meridian_cargo_records
		WHERE shipper_sanctions_status IS NOT NULL OR consignee_sanctions_status IS NOT NULL
	`).Scan(&mcrWithSanctions)

	// Aggregate views from migration 012 — silently 0 / empty if missing.
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM mcr_corridor_aggregates_company
	`).Scan(&mcrCorridorCompanyPairs)

	topCorridors := queryTopCorridors(ctx, pool)

	_ = pool.QueryRow(ctx, `
		SELECT MAX(GREATEST(created_at, COALESCE(event_date, created_at)))
		FROM meridian_cargo_records
	`).Scan(&lastCargoAt)
	_ = pool.QueryRow(ctx, `
		SELECT value FROM oil_live_sync_state WHERE key = 'last_graph_sync_at'
	`).Scan(&lastGraphSync)

	return syncStatusSummary{
		TerminalCount:                 terminalCount,
		CompanyCount:                  companyCount,
		CargoRecordCount:              cargoCount,
		PortCallCount:                 portCallCount,
		OpenOpportunityCount:          openOpps,
		CorridorFullCount:             corridorFull,
		CorridorPartialCount:          corridorPartial,
		McrWithLeiCount:               mcrWithLEI,
		McrWithSanctionsScreenedCount: mcrWithSanctions,
		McrCorridorCompanyPairCount:   mcrCorridorCompanyPairs,
		TopCorridors:                  topCorridors,
		LastGraphSyncAt:               formatTimePtr(lastGraphSync),
		LastCargoAt:                   formatTimePtr(lastCargoAt),
		Disclaimer:                    "Counts from Meridian DB — inferred tiers where noted.",
	}
}

// queryTopCorridors returns up to 5 country-pair corridors by cargo count from
// mcr_corridor_aggregates_country. Returns an empty (non-nil) slice if the view
// is missing (migration 012 not yet applied) so the JSON response stays stable.
func queryTopCorridors(ctx context.Context, pool *pgxpool.Pool) []TopCorridor {
	out := []TopCorridor{}
	rows, err := pool.Query(ctx, `
		SELECT load_country, discharge_country, commodity_family, cargo_count
		FROM mcr_corridor_aggregates_country
		ORDER BY cargo_count DESC NULLS LAST
		LIMIT 5
	`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var shipperCountry, consigneeCountry, family string
		var cargoCount int
		if err := rows.Scan(&shipperCountry, &consigneeCountry, &family, &cargoCount); err != nil {
			return out
		}
		out = append(out, TopCorridor{
			ShipperCountry:   shipperCountry,
			ConsigneeCountry: consigneeCountry,
			CommodityFamily:  family,
			CargoCount:       cargoCount,
		})
	}
	return out
}
