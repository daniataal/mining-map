package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ParityTableSpec defines how to compare legacy mining_db row counts with madsan_db.
type ParityTableSpec struct {
	LegacyTable    string `json:"legacy_table"`
	LegacyCountSQL string `json:"-"`
	MadsanCountSQL string `json:"-"`
	MadsanTarget   string `json:"madsan_target"`
	Critical       bool   `json:"critical"`
}

// ParityTableResult is one table comparison in the parity report.
type ParityTableResult struct {
	LegacyTable string  `json:"legacy_table"`
	MadsanTarget string `json:"madsan_target"`
	LegacyCount int64   `json:"legacy_count"`
	MadsanCount int64   `json:"madsan_count"`
	Drift       int64   `json:"drift"`
	DriftPct    float64 `json:"drift_pct"`
	Critical    bool    `json:"critical"`
	OK          bool    `json:"ok"`
	Note        string  `json:"note,omitempty"`
}

// ParityReport is printed as JSON by cmd/legacy-parity.
type ParityReport struct {
	CheckedAt      time.Time           `json:"checked_at"`
	ThresholdPct   float64             `json:"threshold_pct"`
	Passed         bool                `json:"passed"`
	FailedCritical []string            `json:"failed_critical,omitempty"`
	Tables         []ParityTableResult `json:"tables"`
}

// LegacyParityCatalog returns parity specs aligned with legacyTableCatalog import filters.
func LegacyParityCatalog() []ParityTableSpec {
	return []ParityTableSpec{
		{
			LegacyTable:    "oil_vessels",
			LegacyCountSQL: `SELECT COUNT(*)::bigint FROM oil_vessels`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM vessels`,
			MadsanTarget:   "vessels",
			Critical:       true,
		},
		{
			LegacyTable:    "oil_companies",
			LegacyCountSQL: `SELECT COUNT(*)::bigint FROM oil_companies`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM companies`,
			MadsanTarget:   "companies",
			Critical:       false,
		},
		{
			LegacyTable:    "licenses",
			LegacyCountSQL: `SELECT COUNT(*)::bigint FROM licenses WHERE lat IS NOT NULL AND lng IS NOT NULL`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM assets WHERE legacy_table = 'legacy_licenses'`,
			MadsanTarget:   "assets(legacy_licenses)",
			Critical:       true,
		},
		{
			LegacyTable:    "petroleum_osm_features",
			LegacyCountSQL: `SELECT COUNT(*)::bigint FROM petroleum_osm_features WHERE geom IS NOT NULL`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM assets WHERE legacy_table = 'legacy_petroleum_osm_features'`,
			MadsanTarget:   "assets(legacy_petroleum_osm_features)",
			Critical:       true,
		},
	}
}

// RunLegacyParity compares legacy vs madsan counts and returns a report.
// Critical tables fail when drift_pct exceeds thresholdPct.
func RunLegacyParity(ctx context.Context, legacy, madsan *pgxpool.Pool, thresholdPct float64) (ParityReport, error) {
	if thresholdPct <= 0 {
		thresholdPct = 5.0
	}
	report := ParityReport{
		CheckedAt:    time.Now().UTC(),
		ThresholdPct: thresholdPct,
		Passed:       true,
	}
	for _, spec := range LegacyParityCatalog() {
		row, err := compareParityTable(ctx, legacy, madsan, spec, thresholdPct)
		if err != nil {
			return report, fmt.Errorf("%s: %w", spec.LegacyTable, err)
		}
		report.Tables = append(report.Tables, row)
		if spec.Critical && !row.OK {
			report.Passed = false
			report.FailedCritical = append(report.FailedCritical, spec.LegacyTable)
		}
	}
	return report, nil
}

func compareParityTable(ctx context.Context, legacy, madsan *pgxpool.Pool, spec ParityTableSpec, thresholdPct float64) (ParityTableResult, error) {
	var legacyCount, madsanCount int64
	if err := legacy.QueryRow(ctx, spec.LegacyCountSQL).Scan(&legacyCount); err != nil {
		return ParityTableResult{}, fmt.Errorf("legacy count: %w", err)
	}
	if err := madsan.QueryRow(ctx, spec.MadsanCountSQL).Scan(&madsanCount); err != nil {
		return ParityTableResult{}, fmt.Errorf("madsan count: %w", err)
	}
	drift := madsanCount - legacyCount
	driftPct := 0.0
	if legacyCount > 0 {
		driftPct = math.Abs(float64(drift)) / float64(legacyCount) * 100
	} else if madsanCount > 0 {
		driftPct = 100
	}
	ok := driftPct <= thresholdPct
	note := ""
	if spec.LegacyTable == "oil_companies" {
		note = "companies dedupe by name+country; madsan count may be lower than legacy"
		ok = true // informational only
	}
	if spec.LegacyTable == "oil_vessels" && madsanCount >= legacyCount {
		ok = true // AIS sync may add vessels beyond legacy snapshot
		note = "madsan may exceed legacy when live AIS sync is enabled"
	}
	return ParityTableResult{
		LegacyTable:  spec.LegacyTable,
		MadsanTarget: spec.MadsanTarget,
		LegacyCount:  legacyCount,
		MadsanCount:  madsanCount,
		Drift:        drift,
		DriftPct:     round2(driftPct),
		Critical:     spec.Critical,
		OK:           ok,
		Note:         note,
	}, nil
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

// ParityReportJSON marshals the report for stdout.
func ParityReportJSON(report ParityReport) ([]byte, error) {
	return json.MarshalIndent(report, "", "  ")
}
