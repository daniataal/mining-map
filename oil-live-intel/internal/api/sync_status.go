package api

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TopCorridor is a single row in the sync-status `top_corridors` digest.
type TopCorridor struct {
	ShipperCountry   string `json:"shipper_country"`
	ConsigneeCountry string `json:"consignee_country"`
	CommodityFamily  string `json:"commodity_family"`
	CargoCount       int    `json:"cargo_count"`
}

// McrTierCount groups meridian_cargo_records by bol_tier.
type McrTierCount struct {
	BolTier string `json:"bol_tier"`
	Count   int    `json:"count"`
}

// TradeFlowSourceCount groups oil_trade_flows by data_source (macro ingest).
type TradeFlowSourceCount struct {
	DataSource string `json:"data_source"`
	Count      int    `json:"count"`
}

type syncStatusSummary struct {
	TerminalCount                 int                       `json:"terminal_count"`
	CompanyCount                  int                       `json:"company_count"`
	CargoRecordCount              int                       `json:"cargo_record_count"`
	PortCallCount                 int                       `json:"port_call_count"`
	OpenOpportunityCount          int                       `json:"open_opportunity_count"`
	CorridorFullCount             int                       `json:"corridor_full_count"`
	CorridorPartialCount          int                       `json:"corridor_partial_count"`
	McrWithLeiCount               int                       `json:"mcr_with_lei_count"`
	McrWithSanctionsScreenedCount int                       `json:"mcr_with_sanctions_screened_count"`
	McrCorridorCompanyPairCount   int                       `json:"mcr_corridor_company_pair_count"`
	TopCorridors                  []TopCorridor             `json:"top_corridors"`
	McrByTier                     []McrTierCount            `json:"mcr_by_tier"`
	ManifestByTier                []McrTierCount            `json:"manifest_by_tier"`
	OilTradeFlowsBySource         []TradeFlowSourceCount    `json:"oil_trade_flows_by_source"`
	OilTradeFlowCount             int                       `json:"oil_trade_flow_count"`
	EiaHistoricImportCount        int                       `json:"eia_historic_import_count"`
	TradeManifestRowCount         int                       `json:"trade_manifest_row_count"`
	LiveVesselCount               int                       `json:"live_vessel_count"`
	LiveAisPortCallCount          int                       `json:"live_ais_port_call_count"`
	VesselObservationCount        int                       `json:"vessel_observation_count"`
	ShipVaultCacheCount           int                       `json:"shipvault_cache_count"`
	ShipVaultCredentialCount      int                       `json:"shipvault_credential_count"`
	LastShipVaultCacheAt          any                       `json:"last_shipvault_cache_at"`
	CoverageWatchZoneCount        int                       `json:"coverage_watch_zone_count"`
	CoverageGapWatchZoneCount     int                       `json:"coverage_gap_watch_zone_count"`
	LastGraphSyncAt               any                       `json:"last_graph_sync_at"`
	LastCargoAt                   any                       `json:"last_cargo_at"`
	LastComtradeSyncAt            any                       `json:"last_comtrade_sync_at"`
	LastComtradeSyncStatus        *string                   `json:"last_comtrade_sync_status"`
	EurostatTradeFlowCount        int                       `json:"eurostat_trade_flow_count"`
	LastEurostatSyncAt            any                       `json:"last_eurostat_sync_at"`
	LastEurostatSyncStatus        *string                   `json:"last_eurostat_sync_status"`
	JodiSnapshotCount             int                       `json:"jodi_snapshot_count"`
	LastJodiSyncAt                any                       `json:"last_jodi_sync_at"`
	LastJodiSyncStatus            *string                   `json:"last_jodi_sync_status"`
	DemoPortCallCount             int                       `json:"demo_port_call_count"`
	DemoCargoRecordCount          int                       `json:"demo_cargo_record_count"`
	ProductionCargoRecordCount    int                       `json:"production_cargo_record_count"`
	LastVesselObservationAt       any                       `json:"last_vessel_observation_at"`
	GraphSyncSteps                []GraphSyncStepOutcome    `json:"graph_sync_steps,omitempty"`
	WatchZoneObservations24h      []WatchZoneObservation24h `json:"watch_zone_observations_24h,omitempty"`
	Disclaimer                    string                    `json:"disclaimer"`
}

func querySyncStatus(ctx context.Context, pool *pgxpool.Pool) syncStatusSummary {
	var terminalCount, cargoCount, portCallCount, companyCount int
	var corridorFull, corridorPartial, openOpps int
	var mcrWithLEI, mcrWithSanctions, mcrCorridorCompanyPairs int
	var oilTradeFlows, eiaHistoric, tradeManifests, eurostatTradeFlows, jodiSnapshots int
	var liveVessels, liveAisPortCalls, vesselObservations, coverageWatchZones, coverageGapZones int
	var shipVaultCacheCount, shipVaultCredentialCount int
	var demoPortCalls, demoCargo, productionCargo int
	var lastGraphSync, lastCargoAt, lastComtrade, lastEurostat, lastJodi, lastVesselObs, lastShipVaultCache *time.Time
	var lastComtradeStatus, lastEurostatStatus, lastJodiStatus *string

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
		SELECT COUNT(*)::int FROM meridian_cargo_records
		WHERE shipper_lei IS NOT NULL OR consignee_lei IS NOT NULL
	`).Scan(&mcrWithLEI)
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM meridian_cargo_records
		WHERE shipper_sanctions_status IS NOT NULL OR consignee_sanctions_status IS NOT NULL
	`).Scan(&mcrWithSanctions)
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM mcr_corridor_aggregates_company
	`).Scan(&mcrCorridorCompanyPairs)

	oilTradeFlows = countTable(ctx, pool, `SELECT COUNT(*)::int FROM oil_trade_flows`)
	eurostatTradeFlows = countTable(ctx, pool, `
		SELECT COUNT(*)::int FROM oil_trade_flows WHERE data_source = 'eurostat'
	`)
	jodiSnapshots = countTable(ctx, pool, `SELECT COUNT(*)::int FROM jodi_oil_snapshots`)
	eiaHistoric = countTable(ctx, pool, `SELECT COUNT(*)::int FROM eia_historic_imports`)
	tradeManifests = countTable(ctx, pool, `SELECT COUNT(*)::int FROM trade_manifest_rows`)
	vesselObservations = countTable(ctx, pool, `SELECT COUNT(*)::int FROM oil_vessel_position_observations`)
	shipVaultCacheCount = countTable(ctx, pool, `SELECT COUNT(*)::int FROM vessel_enrichment_cache`)
	shipVaultCredentialCount = countTable(ctx, pool, `
		SELECT COUNT(*)::int
		FROM integration_credentials
		WHERE provider = 'shipvault' AND credential_key = 'refresh_token'
		  AND NULLIF(TRIM(credential_value), '') IS NOT NULL
	`)
	liveVessels = countTable(ctx, pool, `
		SELECT COUNT(DISTINCT mmsi)::int
		FROM (
			SELECT mmsi, COALESCE(position_time, observed_at) AS ts
			FROM oil_vessel_position_observations
			UNION ALL
			SELECT mmsi, ts FROM oil_ais_positions
		) v
		WHERE v.ts > now() - interval '24 hours'
	`)
	liveAisPortCalls = countTable(ctx, pool, `
		SELECT COUNT(*)::int FROM oil_port_calls
		WHERE NULLIF(TRIM(metadata->>'source'), '') = 'live_ais'
		   OR (
		     evidence::text ILIKE '%inferred from public ais%'
		     AND evidence::text NOT ILIKE '%seed_port_calls%'
		     AND evidence::text NOT ILIKE '%demo seed%'
		   )
	`)
	coverageWatchZones = countTable(ctx, pool, `SELECT COUNT(*)::int FROM maritime_watch_zones`)
	coverageGapZones = countTable(ctx, pool, `
		SELECT COUNT(*)::int
		FROM maritime_watch_zones z
		WHERE NOT EXISTS (
		  SELECT 1 FROM (
		    SELECT lat, lng, COALESCE(position_time, observed_at) AS ts
		    FROM oil_vessel_position_observations
		    UNION ALL
		    SELECT lat, lon AS lng, ts
		    FROM oil_ais_positions
		  ) o
		  WHERE o.lat >= z.min_lat AND o.lat <= z.max_lat
		    AND o.lng >= z.min_lng AND o.lng <= z.max_lng
		    AND o.ts > now() - interval '3 hours'
		)
	`)
	demoPortCalls = countTable(ctx, pool, `
		SELECT COUNT(*)::int FROM oil_port_calls
		WHERE COALESCE(evidence::text, '') ILIKE '%seed_port_calls%'
		   OR COALESCE(evidence::text, '') ILIKE '%demo seed%'
		   OR COALESCE(metadata::text, '') ILIKE '%seed_port_calls%'
	`)
	demoCargo = countTable(ctx, pool, `
		SELECT COUNT(*)::int FROM meridian_cargo_records
		WHERE COALESCE(evidence_chain::text, '') ILIKE '%seed_port_calls%'
		   OR COALESCE(evidence_chain::text, '') ILIKE '%demo seed%'
		   OR LOWER(COALESCE(bol_tier, '')) IN ('demo', 'seed', 'seed_port_calls')
	`)
	productionCargo = countTable(ctx, pool, `
		SELECT COUNT(*)::int FROM meridian_cargo_records
		WHERE COALESCE(evidence_chain::text, '') NOT ILIKE '%seed_port_calls%'
		  AND COALESCE(evidence_chain::text, '') NOT ILIKE '%demo seed%'
		  AND LOWER(COALESCE(bol_tier, '')) NOT IN ('demo', 'seed', 'seed_port_calls')
	`)

	topCorridors := queryTopCorridors(ctx, pool)
	mcrByTier := queryMcrByTier(ctx, pool)
	manifestByTier := queryManifestByTier(ctx, pool)
	oilFlowsBySource := queryOilTradeFlowsBySource(ctx, pool)

	_ = pool.QueryRow(ctx, `
		SELECT MAX(GREATEST(created_at, COALESCE(event_date, created_at)))
		FROM meridian_cargo_records
	`).Scan(&lastCargoAt)
	_ = pool.QueryRow(ctx, `
		SELECT value FROM oil_live_sync_state WHERE key = 'last_graph_sync_at'
	`).Scan(&lastGraphSync)
	_ = pool.QueryRow(ctx, `
		SELECT finished_at, status FROM comtrade_sync_runs
		WHERE status = 'ok' ORDER BY finished_at DESC NULLS LAST LIMIT 1
	`).Scan(&lastComtrade, &lastComtradeStatus) //nolint:errcheck — table may be absent on fresh DB
	_ = pool.QueryRow(ctx, `
		SELECT value, metadata->>'status' FROM oil_live_sync_state
		WHERE key = 'last_eurostat_sync'
	`).Scan(&lastEurostat, &lastEurostatStatus) //nolint:errcheck — row may be absent
	_ = pool.QueryRow(ctx, `
		SELECT value, metadata->>'status' FROM oil_live_sync_state
		WHERE key = 'last_jodi_sync'
	`).Scan(&lastJodi, &lastJodiStatus) //nolint:errcheck — row may be absent
	_ = pool.QueryRow(ctx, `
		SELECT MAX(ts) FROM (
			SELECT COALESCE(position_time, observed_at) AS ts
			FROM oil_vessel_position_observations
			UNION ALL
			SELECT ts
			FROM oil_ais_positions
		) v
	`).Scan(&lastVesselObs)
	_ = pool.QueryRow(ctx, `SELECT MAX(updated_at) FROM vessel_enrichment_cache`).Scan(&lastShipVaultCache)

	graphSteps := queryGraphSyncSteps(ctx, pool)
	watchZoneObs := queryWatchZoneObservations24h(ctx, pool)

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
		McrByTier:                     mcrByTier,
		ManifestByTier:                manifestByTier,
		OilTradeFlowsBySource:         oilFlowsBySource,
		OilTradeFlowCount:             oilTradeFlows,
		EurostatTradeFlowCount:        eurostatTradeFlows,
		EiaHistoricImportCount:        eiaHistoric,
		TradeManifestRowCount:         tradeManifests,
		LiveVesselCount:               liveVessels,
		LiveAisPortCallCount:          liveAisPortCalls,
		VesselObservationCount:        vesselObservations,
		ShipVaultCacheCount:           shipVaultCacheCount,
		ShipVaultCredentialCount:      shipVaultCredentialCount,
		LastShipVaultCacheAt:          formatTimePtr(lastShipVaultCache),
		CoverageWatchZoneCount:        coverageWatchZones,
		CoverageGapWatchZoneCount:     coverageGapZones,
		LastGraphSyncAt:               formatTimePtr(lastGraphSync),
		LastCargoAt:                   formatTimePtr(lastCargoAt),
		LastComtradeSyncAt:            formatTimePtr(lastComtrade),
		LastComtradeSyncStatus:        lastComtradeStatus,
		LastEurostatSyncAt:            formatTimePtr(lastEurostat),
		LastEurostatSyncStatus:        lastEurostatStatus,
		JodiSnapshotCount:             jodiSnapshots,
		LastJodiSyncAt:                formatTimePtr(lastJodi),
		LastJodiSyncStatus:            lastJodiStatus,
		DemoPortCallCount:             demoPortCalls,
		DemoCargoRecordCount:          demoCargo,
		ProductionCargoRecordCount:    productionCargo,
		LastVesselObservationAt:       formatTimePtr(lastVesselObs),
		GraphSyncSteps:                graphSteps,
		WatchZoneObservations24h:      watchZoneObs,
		Disclaimer:                    "Counts from MadSan Intelligence DB — inferred tiers where noted; demo/seed rows reported separately.",
	}
}

func queryOilTradeFlowsBySource(ctx context.Context, pool *pgxpool.Pool) []TradeFlowSourceCount {
	out := []TradeFlowSourceCount{}
	rows, err := pool.Query(ctx, `
		SELECT COALESCE(NULLIF(TRIM(data_source), ''), 'unknown') AS data_source, COUNT(*)::int
		FROM oil_trade_flows
		GROUP BY 1
		ORDER BY 2 DESC
		LIMIT 12
	`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var source string
		var count int
		if err := rows.Scan(&source, &count); err != nil {
			return out
		}
		out = append(out, TradeFlowSourceCount{DataSource: source, Count: count})
	}
	return out
}

func queryMcrByTier(ctx context.Context, pool *pgxpool.Pool) []McrTierCount {
	return queryBolTierCounts(ctx, pool, "meridian_cargo_records")
}

func queryManifestByTier(ctx context.Context, pool *pgxpool.Pool) []McrTierCount {
	return queryBolTierCounts(ctx, pool, "trade_manifest_rows")
}

func queryBolTierCounts(ctx context.Context, pool *pgxpool.Pool, table string) []McrTierCount {
	out := []McrTierCount{}
	// table name is fixed internal constant — not user input.
	sql := fmt.Sprintf(`
		SELECT COALESCE(NULLIF(TRIM(bol_tier), ''), 'inferred') AS tier, COUNT(*)::int
		FROM %s
		GROUP BY 1
		ORDER BY 2 DESC
	`, table)
	rows, err := pool.Query(ctx, sql)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var tier string
		var count int
		if err := rows.Scan(&tier, &count); err != nil {
			return out
		}
		out = append(out, McrTierCount{BolTier: tier, Count: count})
	}
	return out
}

func countTable(ctx context.Context, pool *pgxpool.Pool, query string) int {
	var n int
	if err := pool.QueryRow(ctx, query).Scan(&n); err != nil {
		return 0
	}
	return n
}

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
