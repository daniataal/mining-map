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

// LicenseImportTiers breaks license parity into honest import tiers (legacy mining_db).
type LicenseImportTiers struct {
	LegacyTotal           int64 `json:"legacy_total"`
	NotImportableNoCoords int64 `json:"not_importable_no_coords"`
	ImportPoolGeocoded    int64 `json:"import_pool_geocoded"`
	ExpectedSkipEmptyName int64 `json:"expected_skip_empty_name"`
	ExpectedDedupKeys     int64 `json:"expected_dedup_keys"`
	UnderImportGap        int64 `json:"under_import_gap"`
}

// TerminalImportTiers breaks oil_terminals parity into honest import tiers.
// Each legacy row has a unique id; name+country dedup would collapse ~18k storage tanks
// that share generic names (e.g. "Unnamed Storage Terminal").
type TerminalImportTiers struct {
	LegacyTotal           int64 `json:"legacy_total"`
	NotImportableNoGeom   int64 `json:"not_importable_no_geom"`
	ImportPoolGeocoded    int64 `json:"import_pool_geocoded"`
	ExpectedSkipEmptyName int64 `json:"expected_skip_empty_name"`
	NameDedupKeys         int64 `json:"name_dedup_keys"`
	UnderImportGap        int64 `json:"under_import_gap"`
}

// PetroleumImportTiers breaks petroleum_osm_features parity into honest import tiers.
// The importer upserts canonical assets by (normalized_name, asset_type, country); many
// raw OSM features (especially multi-segment pipelines and same-named storage features)
// collapse to one asset. Pipeline segment geometry is preserved separately in
// pipeline_graph_edges, so dedup is not data loss.
type PetroleumImportTiers struct {
	LegacyTotal        int64 `json:"legacy_total"`
	WithNameOrOperator int64 `json:"with_name_or_operator"`
	SyntheticNamed     int64 `json:"synthetic_named"`
	ExpectedDedupKeys  int64 `json:"expected_dedup_keys"`
	UnderImportGap     int64 `json:"under_import_gap"`
}

// ParityTableResult is one table comparison in the parity report.
type ParityTableResult struct {
	LegacyTable    string                `json:"legacy_table"`
	MadsanTarget   string                `json:"madsan_target"`
	LegacyCount    int64                 `json:"legacy_count"`
	MadsanCount    int64                 `json:"madsan_count"`
	Drift          int64                 `json:"drift"`
	DriftPct       float64               `json:"drift_pct"`
	Critical       bool                  `json:"critical"`
	OK             bool                  `json:"ok"`
	Note           string                `json:"note,omitempty"`
	LicenseTiers   *LicenseImportTiers   `json:"license_tiers,omitempty"`
	PetroleumTiers *PetroleumImportTiers `json:"petroleum_tiers,omitempty"`
	TerminalTiers  *TerminalImportTiers  `json:"terminal_tiers,omitempty"`
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
			LegacyTable: "licenses",
			// Import upserts assets by normalized company + asset_type + country; raw license rows dedupe.
			LegacyCountSQL: `
				SELECT COUNT(*)::bigint FROM (
					SELECT DISTINCT
						lower(trim(company)),
						CASE WHEN lower(COALESCE(sector, 'mining')) = 'mining' THEN 'mine' ELSE 'processing_plant' END,
						COALESCE(upper(trim(country)), '')
					FROM licenses
					WHERE lat IS NOT NULL AND lng IS NOT NULL
					  AND NULLIF(trim(company), '') IS NOT NULL
				) importable`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM assets WHERE legacy_table = 'legacy_licenses'`,
			MadsanTarget:   "assets(legacy_licenses)",
			Critical:       true,
		},
		{
			LegacyTable:    "oil_port_calls",
			LegacyCountSQL: `SELECT COUNT(*)::bigint FROM oil_port_calls`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM core_signals WHERE signal_type = 'port_call'`,
			MadsanTarget:   "core_signals(port_call)",
			Critical:       true,
		},
		{
			LegacyTable:    "oil_sts_events",
			LegacyCountSQL: `SELECT COUNT(*)::bigint FROM oil_sts_events`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM core_signals WHERE signal_type = 'sts'`,
			MadsanTarget:   "core_signals(sts)",
			Critical:       true,
		},
		{
			LegacyTable:    "eia_historic_imports",
			LegacyCountSQL: `SELECT COUNT(*)::bigint FROM eia_historic_imports`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM prices WHERE price_type = 'eia_historic_import'`,
			MadsanTarget:   "prices(eia_historic_import)",
			Critical:       true,
		},
		{
			LegacyTable:    "oil_commercial_events",
			LegacyCountSQL: `SELECT COUNT(*)::bigint FROM oil_commercial_events`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM core_signals WHERE signal_type = 'commercial_event'`,
			MadsanTarget:   "core_signals(commercial_event)",
			Critical:       false,
		},
		{
			LegacyTable:    "oil_company_contacts",
			LegacyCountSQL: `SELECT COUNT(*)::bigint FROM oil_company_contacts`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM contacts WHERE metadata->>'legacy_contact_id' IS NOT NULL`,
			MadsanTarget:   "contacts(legacy)",
			Critical:       false,
		},
		{
			LegacyTable:    "broker_deal_packs",
			LegacyCountSQL: `SELECT COUNT(*)::bigint FROM broker_deal_packs`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM deals WHERE metadata->>'legacy_broker_pack_id' IS NOT NULL`,
			MadsanTarget:   "deals(legacy_broker_pack)",
			Critical:       false,
		},
		{
			LegacyTable:    "oil_intelligence_cards",
			LegacyCountSQL: `SELECT COUNT(*)::bigint FROM oil_intelligence_cards`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM evidence WHERE claim_type LIKE 'intel_card:%'`,
			MadsanTarget:   "evidence(intel_card)",
			Critical:       false,
		},
		{
			LegacyTable: "entity_relationships",
			LegacyCountSQL: `
				SELECT COUNT(*)::bigint FROM entity_relationships
				WHERE fingerprint IS NOT NULL AND NULLIF(trim(fingerprint), '') IS NOT NULL`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM relationships WHERE metadata->>'legacy_fingerprint' IS NOT NULL`,
			MadsanTarget:   "relationships(legacy_fingerprint)",
			Critical:       false,
		},
		{
			LegacyTable:    "oil_terminals",
			LegacyCountSQL: `SELECT COUNT(*)::bigint FROM oil_terminals WHERE geom IS NOT NULL`,
			MadsanCountSQL: `SELECT COUNT(*)::bigint FROM assets WHERE legacy_table = 'legacy_oil_terminals'`,
			MadsanTarget:   "assets(legacy_oil_terminals)",
			Critical:       true,
		},
		{
			LegacyTable: "petroleum_osm_features",
			// Import upserts assets by normalized_name + asset_type (+ empty country);
			// multi-segment pipelines and same-named features dedupe. Compare against the
			// expected dedup-key count, not the raw OSM row count.
			LegacyCountSQL: petroleumDedupKeySQL,
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
	if spec.LegacyTable == "oil_port_calls" || spec.LegacyTable == "oil_sts_events" || spec.LegacyTable == "oil_commercial_events" {
		// Import skips rows without a matching madsan vessel/company — drift vs raw legacy count is expected.
		if legacyCount > 0 {
			coverage := float64(madsanCount) / float64(legacyCount) * 100
			note = fmt.Sprintf("madsan count may be lower: only rows with matched vessel/company import (coverage %.1f%%)", coverage)
		}
		if madsanCount > 0 && driftPct <= 35 {
			ok = true
		}
	}
	if spec.LegacyTable == "oil_intelligence_cards" {
		if legacyCount > 0 {
			coverage := float64(madsanCount) / float64(legacyCount) * 100
			note = fmt.Sprintf("import requires matched vessel/company/terminal entity (coverage %.1f%%)", coverage)
		}
		if madsanCount >= legacyCount*95/100 {
			ok = true
		}
	}
	if spec.LegacyTable == "entity_relationships" {
		if legacyCount > 0 {
			coverage := float64(madsanCount) / float64(legacyCount) * 100
			note = fmt.Sprintf("import requires license asset + resolvable target company (coverage %.1f%%)", coverage)
		}
		if madsanCount > 0 && driftPct <= 15 {
			ok = true
		}
	}
	if spec.LegacyTable == "eia_historic_imports" && madsanCount >= legacyCount*95/100 {
		ok = true
	}
	if spec.LegacyTable == "licenses" {
		tiers, terr := fetchLicenseImportTiers(ctx, legacy)
		if terr != nil {
			return ParityTableResult{}, terr
		}
		tiers.UnderImportGap = tiers.ExpectedDedupKeys - madsanCount
		if tiers.UnderImportGap < 0 {
			tiers.UnderImportGap = 0
		}
		note = fmt.Sprintf(
			"legacy_count is expected_dedup_keys (%d); raw geocoded=%d; empty-name skip=%d; no-coords=%d; under_import_gap=%d",
			tiers.ExpectedDedupKeys, tiers.ImportPoolGeocoded, tiers.ExpectedSkipEmptyName,
			tiers.NotImportableNoCoords, tiers.UnderImportGap,
		)
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
			LicenseTiers: &tiers,
		}, nil
	}
	if spec.LegacyTable == "petroleum_osm_features" {
		tiers, terr := fetchPetroleumImportTiers(ctx, legacy)
		if terr != nil {
			return ParityTableResult{}, terr
		}
		tiers.ExpectedDedupKeys = legacyCount
		tiers.UnderImportGap = tiers.ExpectedDedupKeys - madsanCount
		if tiers.UnderImportGap < 0 {
			tiers.UnderImportGap = 0
		}
		note = fmt.Sprintf(
			"legacy_count is expected_dedup_keys (%d) not raw OSM rows (%d); name+operator=%d; synthetic-named=%d; under_import_gap=%d; pipeline segment geometry preserved in pipeline_graph_edges",
			tiers.ExpectedDedupKeys, tiers.LegacyTotal, tiers.WithNameOrOperator,
			tiers.SyntheticNamed, tiers.UnderImportGap,
		)
		return ParityTableResult{
			LegacyTable:    spec.LegacyTable,
			MadsanTarget:   spec.MadsanTarget,
			LegacyCount:    legacyCount,
			MadsanCount:    madsanCount,
			Drift:          drift,
			DriftPct:       round2(driftPct),
			Critical:       spec.Critical,
			OK:             ok,
			Note:           note,
			PetroleumTiers: &tiers,
		}, nil
	}
	if spec.LegacyTable == "oil_terminals" {
		tiers, terr := fetchTerminalImportTiers(ctx, legacy)
		if terr != nil {
			return ParityTableResult{}, terr
		}
		tiers.UnderImportGap = legacyCount - madsanCount
		if tiers.UnderImportGap < 0 {
			tiers.UnderImportGap = 0
		}
		note = fmt.Sprintf(
			"legacy_count is geocoded import pool (%d); name_dedup_keys=%d (not used — import is 1:1 by legacy_id); empty-name skip=%d; no-geom=%d; under_import_gap=%d",
			tiers.ImportPoolGeocoded, tiers.NameDedupKeys, tiers.ExpectedSkipEmptyName,
			tiers.NotImportableNoGeom, tiers.UnderImportGap,
		)
		return ParityTableResult{
			LegacyTable:   spec.LegacyTable,
			MadsanTarget:  spec.MadsanTarget,
			LegacyCount:   legacyCount,
			MadsanCount:   madsanCount,
			Drift:         drift,
			DriftPct:      round2(driftPct),
			Critical:      spec.Critical,
			OK:            ok,
			Note:          note,
			TerminalTiers: &tiers,
		}, nil
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

const licenseTierSQL = `
SELECT
  (SELECT COUNT(*)::bigint FROM licenses) AS legacy_total,
  (SELECT COUNT(*)::bigint FROM licenses WHERE lat IS NULL OR lng IS NULL) AS not_importable_no_coords,
  (SELECT COUNT(*)::bigint FROM licenses WHERE lat IS NOT NULL AND lng IS NOT NULL) AS import_pool_geocoded,
  (SELECT COUNT(*)::bigint FROM licenses
     WHERE lat IS NOT NULL AND lng IS NOT NULL AND NULLIF(trim(company), '') IS NULL) AS expected_skip_empty_name,
  (SELECT COUNT(*)::bigint FROM (
     SELECT DISTINCT
       lower(trim(company)),
       CASE WHEN lower(COALESCE(sector, 'mining')) = 'mining' THEN 'mine' ELSE 'processing_plant' END,
       COALESCE(upper(trim(country)), '')
     FROM licenses
     WHERE lat IS NOT NULL AND lng IS NOT NULL
       AND NULLIF(trim(company), '') IS NOT NULL
   ) importable) AS expected_dedup_keys
`

func fetchLicenseImportTiers(ctx context.Context, legacy *pgxpool.Pool) (LicenseImportTiers, error) {
	var t LicenseImportTiers
	err := legacy.QueryRow(ctx, licenseTierSQL).Scan(
		&t.LegacyTotal,
		&t.NotImportableNoCoords,
		&t.ImportPoolGeocoded,
		&t.ExpectedSkipEmptyName,
		&t.ExpectedDedupKeys,
	)
	return t, err
}

// petroleumNameExpr mirrors normalizeLegacyRow name precedence (name -> operator -> synthetic
// "layer_id:id") and normalizeName (trim + collapse internal whitespace), lowercased for the
// dedup compare. assetTypeExpr mirrors LayerToAssetType.
const petroleumNameExpr = `lower(trim(regexp_replace(
	COALESCE(NULLIF(btrim(tags->>'name'), ''), NULLIF(btrim(tags->>'operator'), ''), layer_id || ':' || id::text),
	'\s+', ' ', 'g')))`

const petroleumAssetTypeExpr = `CASE layer_id
	WHEN 'storage_terminals' THEN 'tank_farm'
	WHEN 'refineries' THEN 'refinery'
	WHEN 'pipelines' THEN 'pipeline'
	ELSE 'terminal' END`

var petroleumDedupKeySQL = `
	SELECT COUNT(*)::bigint FROM (
		SELECT DISTINCT ` + petroleumNameExpr + `, ` + petroleumAssetTypeExpr + `
		FROM petroleum_osm_features
		WHERE geom IS NOT NULL
	) importable`

var petroleumTierSQL = `
SELECT
  (SELECT COUNT(*)::bigint FROM petroleum_osm_features WHERE geom IS NOT NULL) AS legacy_total,
  (SELECT COUNT(*)::bigint FROM petroleum_osm_features
     WHERE geom IS NOT NULL
       AND (NULLIF(btrim(tags->>'name'), '') IS NOT NULL OR NULLIF(btrim(tags->>'operator'), '') IS NOT NULL)) AS with_name_or_operator,
  (SELECT COUNT(*)::bigint FROM petroleum_osm_features
     WHERE geom IS NOT NULL
       AND NULLIF(btrim(tags->>'name'), '') IS NULL AND NULLIF(btrim(tags->>'operator'), '') IS NULL) AS synthetic_named
`

func fetchPetroleumImportTiers(ctx context.Context, legacy *pgxpool.Pool) (PetroleumImportTiers, error) {
	var t PetroleumImportTiers
	err := legacy.QueryRow(ctx, petroleumTierSQL).Scan(
		&t.LegacyTotal,
		&t.WithNameOrOperator,
		&t.SyntheticNamed,
	)
	return t, err
}

// terminalNameExpr mirrors normalizeLegacyRow + TerminalTypeToAssetType for informational name-dedup tier.
const terminalNameExpr = `lower(trim(regexp_replace(name, '\s+', ' ', 'g')))`

const terminalAssetTypeExpr = `CASE lower(COALESCE(terminal_type, ''))
	WHEN 'storage_tank' THEN 'tank_farm'
	WHEN 'tank_farm' THEN 'tank_farm'
	WHEN 'refinery' THEN 'refinery'
	ELSE 'terminal' END`

const terminalTierSQL = `
SELECT
  (SELECT COUNT(*)::bigint FROM oil_terminals) AS legacy_total,
  (SELECT COUNT(*)::bigint FROM oil_terminals WHERE geom IS NULL) AS not_importable_no_geom,
  (SELECT COUNT(*)::bigint FROM oil_terminals WHERE geom IS NOT NULL) AS import_pool_geocoded,
  (SELECT COUNT(*)::bigint FROM oil_terminals
     WHERE geom IS NOT NULL AND NULLIF(btrim(name), '') IS NULL) AS expected_skip_empty_name,
  (SELECT COUNT(*)::bigint FROM (
     SELECT DISTINCT ` + terminalNameExpr + `, ` + terminalAssetTypeExpr + `, COALESCE(upper(trim(country)), '')
     FROM oil_terminals
     WHERE geom IS NOT NULL AND NULLIF(btrim(name), '') IS NOT NULL
   ) name_keys) AS name_dedup_keys
`

func fetchTerminalImportTiers(ctx context.Context, legacy *pgxpool.Pool) (TerminalImportTiers, error) {
	var t TerminalImportTiers
	err := legacy.QueryRow(ctx, terminalTierSQL).Scan(
		&t.LegacyTotal,
		&t.NotImportableNoGeom,
		&t.ImportPoolGeocoded,
		&t.ExpectedSkipEmptyName,
		&t.NameDedupKeys,
	)
	return t, err
}

// ParityReportJSON marshals the report for stdout.
func ParityReportJSON(report ParityReport) ([]byte, error) {
	return json.MarshalIndent(report, "", "  ")
}
