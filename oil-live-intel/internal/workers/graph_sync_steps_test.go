package workers

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGraphSyncGoTerminalOperatorsEnabled(t *testing.T) {
	t.Setenv("OIL_GRAPH_SYNC_GO_TERMINAL_OPERATORS", "true")
	if !graphSyncGoTerminalOperatorsEnabled() {
		t.Fatal("expected enabled for true")
	}
	t.Setenv("OIL_GRAPH_SYNC_GO_TERMINAL_OPERATORS", "0")
	if graphSyncGoTerminalOperatorsEnabled() {
		t.Fatal("expected disabled for 0")
	}
}

func TestGraphSyncGoLicensesEnabled(t *testing.T) {
	t.Setenv("OIL_GRAPH_SYNC_GO_LICENSES", "yes")
	if !graphSyncGoLicensesEnabled() {
		t.Fatal("expected licenses enabled for yes")
	}
}

func TestGraphSyncGoTradeFlowsEnabled(t *testing.T) {
	t.Setenv("OIL_GRAPH_SYNC_GO_TRADE_FLOWS", "on")
	if !graphSyncGoTradeFlowsEnabled() {
		t.Fatal("expected trade_flows enabled for on")
	}
}

func TestGraphSyncGoPortCallsEnabled(t *testing.T) {
	t.Setenv("OIL_GRAPH_SYNC_GO_PORT_CALLS", "true")
	if !graphSyncGoPortCallsEnabled() {
		t.Fatal("expected port_calls enabled for true")
	}
}

func TestGraphSyncGoTEDEnabled(t *testing.T) {
	t.Setenv("OIL_GRAPH_SYNC_GO_TED", "yes")
	if !graphSyncGoTEDEnabled() {
		t.Fatal("expected ted enabled for yes")
	}
}

func TestGraphSyncGoGovAwardsEnabled(t *testing.T) {
	t.Setenv("OIL_GRAPH_SYNC_GO_GOV_AWARDS", "on")
	if !graphSyncGoGovAwardsEnabled() {
		t.Fatal("expected gov_awards enabled for on")
	}
}

func TestGraphSyncGoPetroleumOsmStorageEnabled(t *testing.T) {
	t.Setenv("OIL_GRAPH_SYNC_GO_PETROLEUM_OSM_STORAGE", "true")
	if !graphSyncGoPetroleumOsmStorageEnabled() {
		t.Fatal("expected petroleum_osm_storage enabled for true")
	}
}

func TestGraphSyncGoBunkerFuelSuppliersEnabled(t *testing.T) {
	t.Setenv("OIL_GRAPH_SYNC_GO_BUNKER_FUEL_SUPPLIERS", "true")
	if !graphSyncGoBunkerFuelSuppliersEnabled() {
		t.Fatal("expected bunker_fuel_suppliers enabled for true")
	}
}

func TestGraphSyncGoEurostatTradeEnabled(t *testing.T) {
	t.Setenv("OIL_GRAPH_SYNC_GO_EUROSTAT_TRADE", "true")
	if !graphSyncGoEurostatTradeEnabled() {
		t.Fatal("expected eurostat_trade enabled for true")
	}
}

func TestAnyGraphSyncGoStepEnabled(t *testing.T) {
	t.Setenv("OIL_GRAPH_SYNC_GO_TERMINAL_OPERATORS", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_LICENSES", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_TRADE_FLOWS", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_PORT_CALLS", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_TED", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_GOV_AWARDS", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_EUROSTAT_TRADE", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_PETROLEUM_OSM_STORAGE", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_BUNKER_FUEL_SUPPLIERS", "false")
	if anyGraphSyncGoStepEnabled() {
		t.Fatal("expected all disabled")
	}
	t.Setenv("OIL_GRAPH_SYNC_GO_PORT_CALLS", "true")
	if !anyGraphSyncGoStepEnabled() {
		t.Fatal("expected port_calls flag to enable loop")
	}
}

func TestGraphSyncGoStepsRunOnceDisabled(t *testing.T) {
	t.Setenv("OIL_GRAPH_SYNC_GO_TERMINAL_OPERATORS", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_LICENSES", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_TRADE_FLOWS", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_PORT_CALLS", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_TED", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_GOV_AWARDS", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_EUROSTAT_TRADE", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_PETROLEUM_OSM_STORAGE", "false")
	worker := &GraphSyncGoSteps{}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce disabled: %v", err)
	}
}

func TestGraphSyncGoStepsRunOnceTerminalOperators(t *testing.T) {
	dsn := os.Getenv("OILLIVE_TEST_DB")
	if dsn == "" {
		t.Skip("OILLIVE_TEST_DB not set; skipping DB-backed worker graph-sync test")
	}
	t.Setenv("OIL_GRAPH_SYNC_GO_TERMINAL_OPERATORS", "true")
	t.Setenv("OIL_GRAPH_SYNC_GO_LICENSES", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_TRADE_FLOWS", "false")

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()

	worker := &GraphSyncGoSteps{Pool: pool}
	if err := worker.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce enabled: %v", err)
	}

	var status string
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(metadata->>'status', '') FROM oil_live_sync_state
		WHERE key = 'graphsync_terminal_operators'
	`).Scan(&status)
	if err != nil {
		t.Fatalf("read sync state: %v", err)
	}
	if status != "ok" {
		t.Fatalf("sync state status: got %q want ok", status)
	}
}

func TestGraphSyncGoStepsRunOnceLicenses(t *testing.T) {
	dsn := os.Getenv("OILLIVE_TEST_DB")
	if dsn == "" {
		t.Skip("OILLIVE_TEST_DB not set; skipping DB-backed worker graph-sync test")
	}
	t.Setenv("OIL_GRAPH_SYNC_GO_TERMINAL_OPERATORS", "false")
	t.Setenv("OIL_GRAPH_SYNC_GO_LICENSES", "true")
	t.Setenv("OIL_GRAPH_SYNC_GO_TRADE_FLOWS", "false")

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()

	worker := &GraphSyncGoSteps{Pool: pool}
	if err := worker.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce licenses: %v", err)
	}

	var status string
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(metadata->>'status', '') FROM oil_live_sync_state
		WHERE key = 'graphsync_licenses'
	`).Scan(&status)
	if err != nil {
		t.Fatalf("read sync state: %v", err)
	}
	if status != "ok" {
		t.Fatalf("sync state status: got %q want ok", status)
	}
}
