package ingestion

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	jodiOilImportJobType      = "jodi_oil_import"
	jodiMarketPressureJobType = "jodi_market_pressure"
)

type JODIOilImportOptions struct {
	Dir                  string `json:"dir,omitempty"`
	FileGlob             string `json:"file_glob,omitempty"`
	Force                bool   `json:"force,omitempty"`
	LimitFiles           int    `json:"limit_files,omitempty"`
	BatchSize            int    `json:"batch_size,omitempty"`
	ComputePressure      bool   `json:"compute_pressure,omitempty"`
	ComputeOpportunities bool   `json:"compute_opportunities,omitempty"`
	PressureMonths       int    `json:"pressure_months,omitempty"`
}

type JODIOilImportResult struct {
	Dir             string   `json:"dir"`
	FilesScanned    int      `json:"files_scanned"`
	FilesImported   int      `json:"files_imported"`
	FilesSkipped    int      `json:"files_skipped"`
	RowsRead        int64    `json:"rows_read"`
	NumericRows     int64    `json:"numeric_rows"`
	RowsSkipped     int64    `json:"rows_skipped"`
	RowsUpserted    int64    `json:"rows_upserted"`
	MinMonth        string   `json:"min_month,omitempty"`
	MaxMonth        string   `json:"max_month,omitempty"`
	Products        []string `json:"products,omitempty"`
	Flows           []string `json:"flows,omitempty"`
	Units           []string `json:"units,omitempty"`
	PressureRows    int64    `json:"pressure_rows,omitempty"`
	OpportunityRows int64    `json:"opportunity_rows,omitempty"`
	DurationMillis  int64    `json:"duration_ms"`
}

type JODIMarketPressureOptions struct {
	MonthsBack int    `json:"months_back,omitempty"`
	SinceMonth string `json:"since_month,omitempty"`
}

type JODIMarketPressureResult struct {
	SinceMonth     string `json:"since_month"`
	MaxSourceMonth string `json:"max_source_month,omitempty"`
	RowsWritten    int64  `json:"rows_written"`
	DurationMillis int64  `json:"duration_ms"`
}

type jodiFileStats struct {
	RowsRead     int64
	NumericRows  int64
	RowsSkipped  int64
	RowsUpserted int64
	MinMonth     time.Time
	MaxMonth     time.Time
	Products     map[string]bool
	Flows        map[string]bool
	Units        map[string]bool
}

func (s *Service) processJODIOilImport(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	started := time.Now()
	opts := JODIOilImportOptions{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	res, err := s.ImportJODIOil(ctx, opts)
	if err != nil {
		report, _ := json.Marshal(map[string]any{"duration_ms": time.Since(started).Milliseconds()})
		return s.finishIntelJob(ctx, jobID, "failed", report, err)
	}
	if opts.ComputePressure {
		pressureMonths := opts.PressureMonths
		if pressureMonths <= 0 {
			pressureMonths = 24
		}
		pressure, err := s.ComputeJODIMarketPressure(ctx, JODIMarketPressureOptions{MonthsBack: pressureMonths})
		if err != nil {
			report, _ := json.Marshal(res)
			return s.finishIntelJob(ctx, jobID, "failed", report, err)
		}
		res.PressureRows = pressure.RowsWritten
	}
	if opts.ComputeOpportunities {
		opps, err := s.GenerateOilOpportunityCandidates(ctx, OilOpportunityOptions{})
		if err != nil {
			report, _ := json.Marshal(res)
			return s.finishIntelJob(ctx, jobID, "failed", report, err)
		}
		res.OpportunityRows = opps.RowsWritten
	}
	report, _ := json.Marshal(res)
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) processJODIMarketPressure(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := JODIMarketPressureOptions{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	res, err := s.ComputeJODIMarketPressure(ctx, opts)
	report, _ := json.Marshal(res)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", report, err)
	}
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) ImportJODIOil(ctx context.Context, opts JODIOilImportOptions) (JODIOilImportResult, error) {
	started := time.Now()
	if opts.BatchSize <= 0 {
		opts.BatchSize = 25000
	}
	dir := resolveJODIOilDir(opts.Dir)
	res := JODIOilImportResult{
		Dir:      dir,
		Products: []string{},
		Flows:    []string{},
		Units:    []string{},
	}
	files, err := listJODIFiles(dir, opts.FileGlob)
	if err != nil {
		return res, err
	}
	if opts.LimitFiles > 0 && opts.LimitFiles < len(files) {
		files = files[:opts.LimitFiles]
	}
	res.FilesScanned = len(files)

	products := map[string]bool{}
	flows := map[string]bool{}
	units := map[string]bool{}
	var globalMin, globalMax time.Time

	for _, path := range files {
		checksum, rowCount, err := fingerprintFile(path)
		if err != nil {
			return res, err
		}
		releaseID, skipped, err := s.prepareSourceRelease(ctx, path, checksum, rowCount, opts.Force)
		if err != nil {
			return res, err
		}
		if skipped {
			res.FilesSkipped++
			continue
		}
		stats, err := s.importJODIOilFile(ctx, path, releaseID, opts.BatchSize)
		if err != nil {
			_ = s.markSourceReleaseFailed(ctx, releaseID, err)
			return res, err
		}
		if err := s.completeSourceRelease(ctx, releaseID, stats); err != nil {
			return res, err
		}
		res.FilesImported++
		res.RowsRead += stats.RowsRead
		res.NumericRows += stats.NumericRows
		res.RowsSkipped += stats.RowsSkipped
		res.RowsUpserted += stats.RowsUpserted
		if !stats.MinMonth.IsZero() && (globalMin.IsZero() || stats.MinMonth.Before(globalMin)) {
			globalMin = stats.MinMonth
		}
		if !stats.MaxMonth.IsZero() && (globalMax.IsZero() || stats.MaxMonth.After(globalMax)) {
			globalMax = stats.MaxMonth
		}
		for k := range stats.Products {
			products[k] = true
		}
		for k := range stats.Flows {
			flows[k] = true
		}
		for k := range stats.Units {
			units[k] = true
		}
	}

	res.MinMonth = formatMonth(globalMin)
	res.MaxMonth = formatMonth(globalMax)
	res.Products = sortedKeys(products)
	res.Flows = sortedKeys(flows)
	res.Units = sortedKeys(units)
	res.DurationMillis = time.Since(started).Milliseconds()
	return res, nil
}

func (s *Service) importJODIOilFile(ctx context.Context, path string, releaseID uuid.UUID, batchSize int) (jodiFileStats, error) {
	stats := jodiFileStats{
		Products: map[string]bool{},
		Flows:    map[string]bool{},
		Units:    map[string]bool{},
	}
	f, err := os.Open(path)
	if err != nil {
		return stats, err
	}
	defer f.Close()

	reader := csv.NewReader(f)
	reader.FieldsPerRecord = -1
	header, err := reader.Read()
	if err != nil {
		return stats, fmt.Errorf("read JODI header %s: %w", path, err)
	}
	columns := headerIndex(header)
	if err := requireJODIColumns(columns); err != nil {
		return stats, fmt.Errorf("%s: %w", path, err)
	}

	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return stats, err
	}
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return stats, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `
		CREATE TEMP TABLE tmp_jodi_oil_import (
			ref_area TEXT NOT NULL,
			month DATE NOT NULL,
			energy_product TEXT NOT NULL,
			flow_breakdown TEXT NOT NULL,
			unit_measure TEXT NOT NULL,
			obs_value NUMERIC,
			raw_value TEXT,
			assessment_code TEXT,
			source_file TEXT
		) ON COMMIT DROP
	`)
	if err != nil {
		return stats, err
	}

	source := &jodiCopySource{
		reader:  reader,
		columns: columns,
		file:    filepath.Base(path),
		stats:   &stats,
	}
	if _, err = tx.CopyFrom(ctx,
		pgx.Identifier{"tmp_jodi_oil_import"},
		[]string{"ref_area", "month", "energy_product", "flow_breakdown", "unit_measure", "obs_value", "raw_value", "assessment_code", "source_file"},
		source,
	); err != nil {
		return stats, err
	}
	if err := source.Err(); err != nil {
		return stats, err
	}

	tag, err := tx.Exec(ctx, `
		INSERT INTO market_balance_observations (
			source_key,
			country_code,
			product_code,
			flow_code,
			unit_code,
			month,
			value,
			evidence_label,
			confidence_score,
			source_release_id,
			raw_payload
		)
		SELECT
			'jodi_oil',
			upper(ref_area),
			upper(energy_product),
			upper(flow_breakdown),
			upper(unit_measure),
			month,
			obs_value,
			'reported',
			CASE assessment_code
				WHEN '1' THEN 0.95
				WHEN '2' THEN 0.90
				WHEN '3' THEN 0.85
				ELSE 0.75
			END,
			$1,
			jsonb_build_object(
				'assessment_code', assessment_code,
				'raw_value', raw_value,
				'source_file', source_file
			)
		FROM tmp_jodi_oil_import
		ON CONFLICT (source_key, country_code, product_code, flow_code, unit_code, month)
		DO UPDATE SET
			value = EXCLUDED.value,
			confidence_score = EXCLUDED.confidence_score,
			source_release_id = EXCLUDED.source_release_id,
			raw_payload = EXCLUDED.raw_payload
	`, releaseID)
	if err != nil {
		return stats, err
	}
	stats.RowsUpserted = tag.RowsAffected()
	if err := tx.Commit(ctx); err != nil {
		return stats, err
	}
	return stats, nil
}

func (s *Service) ComputeJODIMarketPressure(ctx context.Context, opts JODIMarketPressureOptions) (JODIMarketPressureResult, error) {
	started := time.Now()
	res := JODIMarketPressureResult{}
	var maxMonth time.Time
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(MAX(month), DATE '1900-01-01') FROM market_balance_observations WHERE source_key = 'jodi_oil'`).Scan(&maxMonth)
	if err != nil {
		return res, err
	}
	if maxMonth.Year() == 1900 {
		res.DurationMillis = time.Since(started).Milliseconds()
		return res, nil
	}
	res.MaxSourceMonth = formatMonth(maxMonth)
	since := time.Date(1900, 1, 1, 0, 0, 0, 0, time.UTC)
	if opts.SinceMonth != "" {
		parsed, err := parseJODIMonth(opts.SinceMonth)
		if err != nil {
			return res, err
		}
		since = parsed
	} else if opts.MonthsBack > 0 {
		since = maxMonth.AddDate(0, -opts.MonthsBack, 0)
	}
	res.SinceMonth = formatMonth(since)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return res, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM market_pressure_scores WHERE source_key = 'jodi_oil' AND month >= $1`, since); err != nil {
		return res, err
	}
	tag, err := tx.Exec(ctx, marketPressureSQL, since)
	if err != nil {
		return res, err
	}
	res.RowsWritten = tag.RowsAffected()
	if err := tx.Commit(ctx); err != nil {
		return res, err
	}
	res.DurationMillis = time.Since(started).Milliseconds()
	return res, nil
}

const marketPressureSQL = `
WITH preferred AS (
	SELECT
		country_code,
		product_code,
		flow_code,
		unit_code,
		month,
		value,
		row_number() OVER (
			PARTITION BY country_code, product_code, flow_code, month
			ORDER BY CASE
				WHEN flow_code IN ('CLOSTLV','STOCKCH') AND unit_code = 'KBBL' THEN 1
				WHEN flow_code NOT IN ('CLOSTLV','STOCKCH') AND unit_code = 'KBD' THEN 1
				WHEN unit_code = 'KBBL' THEN 2
				WHEN unit_code = 'KBD' THEN 3
				WHEN unit_code = 'KTONS' THEN 4
				WHEN unit_code = 'KL' THEN 5
				ELSE 9
			END
		) AS rn
	FROM market_balance_observations
	WHERE source_key = 'jodi_oil'
	  AND value IS NOT NULL
	  AND flow_code IN ('TOTIMPSB','TOTEXPSB','TOTDEMO','STOCKCH','CLOSTLV','REFINOBS','REFGROUT')
),
obs AS (
	SELECT country_code, product_code, flow_code, unit_code, month, value
	FROM preferred
	WHERE rn = 1
),
metrics AS (
	SELECT
		cur.country_code,
		cur.product_code,
		cur.month,
		cur.flow_code,
		cur.value,
		AVG(base.value) AS baseline_value,
		CASE
			WHEN AVG(base.value) IS NULL OR ABS(AVG(base.value)) < 0.000001 THEN NULL
			ELSE (cur.value - AVG(base.value)) / ABS(AVG(base.value))
		END AS pct_delta
	FROM obs cur
	LEFT JOIN obs base
	  ON base.country_code = cur.country_code
	 AND base.product_code = cur.product_code
	 AND base.flow_code = cur.flow_code
	 AND base.month < cur.month
	 AND base.month >= (cur.month - interval '5 years')
	 AND EXTRACT(MONTH FROM base.month) = EXTRACT(MONTH FROM cur.month)
	WHERE cur.month >= $1
	GROUP BY cur.country_code, cur.product_code, cur.month, cur.flow_code, cur.value
),
pivoted AS (
	SELECT
		country_code,
		product_code,
		month,
		MAX(pct_delta) FILTER (WHERE flow_code = 'TOTIMPSB') AS import_delta,
		MAX(pct_delta) FILTER (WHERE flow_code = 'TOTEXPSB') AS export_delta,
		MAX(pct_delta) FILTER (WHERE flow_code = 'TOTDEMO') AS demand_delta,
		MAX(pct_delta) FILTER (WHERE flow_code = 'STOCKCH') AS stock_change_delta,
		MAX(pct_delta) FILTER (WHERE flow_code = 'CLOSTLV') AS closing_stock_delta,
		MAX(pct_delta) FILTER (WHERE flow_code = 'REFINOBS') AS refinery_intake_delta,
		MAX(pct_delta) FILTER (WHERE flow_code = 'REFGROUT') AS refinery_output_delta
	FROM metrics
	GROUP BY country_code, product_code, month
),
scored AS (
	SELECT
		country_code,
		product_code,
		month,
		LEAST(100, GREATEST(0,
			50
			+ COALESCE(import_delta, 0) * 25
			+ COALESCE(demand_delta, 0) * 25
			- COALESCE(stock_change_delta, 0) * 20
			- COALESCE(closing_stock_delta, 0) * 10
		)) AS buyer_pressure_score,
		LEAST(100, GREATEST(0,
			50
			+ COALESCE(export_delta, 0) * 30
			+ COALESCE(refinery_output_delta, refinery_intake_delta, 0) * 15
			+ COALESCE(stock_change_delta, 0) * 10
		)) AS supplier_availability_score,
		LEAST(100, GREATEST(0, 50 - COALESCE(stock_change_delta, closing_stock_delta, 0) * 50)) AS stock_pressure_score,
		LEAST(100, GREATEST(0, 50 + COALESCE(import_delta, 0) * 50)) AS import_pressure_score,
		LEAST(100, GREATEST(0, 50 + COALESCE(export_delta, 0) * 50)) AS export_pressure_score,
		LEAST(100, GREATEST(0, 50 + COALESCE(refinery_output_delta, refinery_intake_delta, 0) * 50)) AS refinery_pressure_score,
		jsonb_build_object(
			'import_delta', import_delta,
			'export_delta', export_delta,
			'demand_delta', demand_delta,
			'stock_change_delta', stock_change_delta,
			'closing_stock_delta', closing_stock_delta,
			'refinery_intake_delta', refinery_intake_delta,
			'refinery_output_delta', refinery_output_delta,
			'baseline', '5_year_same_month'
		) AS components,
		CASE
			WHEN import_delta IS NULL AND export_delta IS NULL AND demand_delta IS NULL AND stock_change_delta IS NULL THEN 0.45
			ELSE 0.75
		END AS confidence_score
	FROM pivoted
)
INSERT INTO market_pressure_scores (
	source_key,
	country_code,
	product_code,
	month,
	buyer_pressure_score,
	supplier_availability_score,
	stock_pressure_score,
	import_pressure_score,
	export_pressure_score,
	refinery_pressure_score,
	baseline_years,
	components,
	evidence_label,
	confidence_score,
	generated_at
)
SELECT
	'jodi_oil',
	country_code,
	product_code,
	month,
	buyer_pressure_score,
	supplier_availability_score,
	stock_pressure_score,
	import_pressure_score,
	export_pressure_score,
	refinery_pressure_score,
	5,
	components,
	'estimated',
	confidence_score,
	now()
FROM scored
ON CONFLICT (source_key, country_code, product_code, month)
DO UPDATE SET
	buyer_pressure_score = EXCLUDED.buyer_pressure_score,
	supplier_availability_score = EXCLUDED.supplier_availability_score,
	stock_pressure_score = EXCLUDED.stock_pressure_score,
	import_pressure_score = EXCLUDED.import_pressure_score,
	export_pressure_score = EXCLUDED.export_pressure_score,
	refinery_pressure_score = EXCLUDED.refinery_pressure_score,
	components = EXCLUDED.components,
	confidence_score = EXCLUDED.confidence_score,
	generated_at = now()
`

type jodiCopySource struct {
	reader  *csv.Reader
	columns map[string]int
	file    string
	values  []any
	err     error
	stats   *jodiFileStats
}

func (s *jodiCopySource) Next() bool {
	for {
		record, err := s.reader.Read()
		if err == io.EOF {
			return false
		}
		if err != nil {
			s.err = err
			return false
		}
		s.stats.RowsRead++
		row, ok := parseJODIRow(record, s.columns, s.file)
		if !ok {
			s.stats.RowsSkipped++
			continue
		}
		month := row[1].(time.Time)
		if s.stats.MinMonth.IsZero() || month.Before(s.stats.MinMonth) {
			s.stats.MinMonth = month
		}
		if s.stats.MaxMonth.IsZero() || month.After(s.stats.MaxMonth) {
			s.stats.MaxMonth = month
		}
		s.stats.NumericRows++
		s.stats.Products[row[2].(string)] = true
		s.stats.Flows[row[3].(string)] = true
		s.stats.Units[row[4].(string)] = true
		s.values = row
		return true
	}
}

func (s *jodiCopySource) Values() ([]any, error) {
	return s.values, nil
}

func (s *jodiCopySource) Err() error {
	return s.err
}

func parseJODIRow(record []string, columns map[string]int, fileName string) ([]any, bool) {
	get := func(key string) string {
		idx, ok := columns[key]
		if !ok || idx < 0 || idx >= len(record) {
			return ""
		}
		return strings.TrimSpace(record[idx])
	}
	rawValue := get("OBS_VALUE")
	value, ok := parseJODINumeric(rawValue)
	if !ok {
		return nil, false
	}
	month, err := parseJODIMonth(get("TIME_PERIOD"))
	if err != nil {
		return nil, false
	}
	refArea := strings.ToUpper(get("REF_AREA"))
	product := strings.ToUpper(get("ENERGY_PRODUCT"))
	flow := strings.ToUpper(get("FLOW_BREAKDOWN"))
	unit := strings.ToUpper(get("UNIT_MEASURE"))
	if refArea == "" || product == "" || flow == "" || unit == "" {
		return nil, false
	}
	return []any{
		refArea,
		month,
		product,
		flow,
		unit,
		value,
		rawValue,
		get("ASSESSMENT_CODE"),
		fileName,
	}, true
}

func parseJODINumeric(raw string) (float64, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "-" || strings.EqualFold(raw, "x") || strings.EqualFold(raw, "na") || strings.EqualFold(raw, "n/a") {
		return 0, false
	}
	value, err := strconv.ParseFloat(raw, 64)
	return value, err == nil
}

func parseJODIMonth(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if len(raw) == len("2006-01") {
		return time.Parse("2006-01-02", raw+"-01")
	}
	return time.Parse("2006-01-02", raw)
}

func headerIndex(header []string) map[string]int {
	out := make(map[string]int, len(header))
	for i, h := range header {
		out[strings.ToUpper(strings.TrimSpace(h))] = i
	}
	return out
}

func requireJODIColumns(columns map[string]int) error {
	for _, col := range []string{"REF_AREA", "TIME_PERIOD", "ENERGY_PRODUCT", "FLOW_BREAKDOWN", "UNIT_MEASURE", "OBS_VALUE"} {
		if _, ok := columns[col]; !ok {
			return fmt.Errorf("missing required column %s", col)
		}
	}
	return nil
}

func (s *Service) prepareSourceRelease(ctx context.Context, path, checksum string, rowCount int64, force bool) (uuid.UUID, bool, error) {
	var existingID uuid.UUID
	var existingStatus string
	err := s.pool.QueryRow(ctx, `
		SELECT id, import_status
		FROM data_source_releases
		WHERE source_key = 'jodi_oil' AND checksum = $1
	`, checksum).Scan(&existingID, &existingStatus)
	if err == nil && existingStatus == "completed" && !force {
		return existingID, true, nil
	}
	var releaseID uuid.UUID
	err = s.pool.QueryRow(ctx, `
		INSERT INTO data_source_releases (
			source_key,
			source_name,
			source_type,
			path,
			checksum,
			row_count,
			release_version,
			attribution,
			license,
			commercial_use_ok,
			import_status,
			metadata
		)
		VALUES (
			'jodi_oil',
			'JODI Oil',
			'csv',
			$1,
			$2,
			$3,
			$4,
			'Joint Organisations Data Initiative (JODI)',
			'JODI public data; verify use terms before redistribution',
			true,
			'running',
			'{}'::jsonb
		)
		ON CONFLICT (source_key, checksum)
		DO UPDATE SET
			path = EXCLUDED.path,
			row_count = EXCLUDED.row_count,
			release_version = EXCLUDED.release_version,
			import_status = 'running',
			updated_at = now()
		RETURNING id
	`, path, checksum, rowCount, filepath.Base(path)).Scan(&releaseID)
	return releaseID, false, err
}

func (s *Service) completeSourceRelease(ctx context.Context, releaseID uuid.UUID, stats jodiFileStats) error {
	metadata, _ := json.Marshal(map[string]any{
		"rows_read":     stats.RowsRead,
		"numeric_rows":  stats.NumericRows,
		"rows_skipped":  stats.RowsSkipped,
		"rows_upserted": stats.RowsUpserted,
		"min_month":     formatMonth(stats.MinMonth),
		"max_month":     formatMonth(stats.MaxMonth),
		"products":      sortedKeys(stats.Products),
		"flows":         sortedKeys(stats.Flows),
		"units":         sortedKeys(stats.Units),
	})
	_, err := s.pool.Exec(ctx, `
		UPDATE data_source_releases
		SET import_status = 'completed',
			imported_at = now(),
			metadata = $2,
			updated_at = now()
		WHERE id = $1
	`, releaseID, metadata)
	return err
}

func (s *Service) markSourceReleaseFailed(ctx context.Context, releaseID uuid.UUID, importErr error) error {
	metadata, _ := json.Marshal(map[string]any{"error": importErr.Error()})
	_, err := s.pool.Exec(ctx, `
		UPDATE data_source_releases
		SET import_status = 'failed',
			metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
			updated_at = now()
		WHERE id = $1
	`, releaseID, metadata)
	return err
}

func resolveJODIOilDir(raw string) string {
	if strings.TrimSpace(raw) != "" {
		return raw
	}
	if env := os.Getenv("MADSAN_JODI_OIL_DIR"); env != "" {
		return env
	}
	candidates := []string{
		"../data/jodi/oil",
		"madsan/data/jodi/oil",
		"../../madsan/data/jodi/oil",
	}
	for _, candidate := range candidates {
		if st, err := os.Stat(candidate); err == nil && st.IsDir() {
			if abs, err := filepath.Abs(candidate); err == nil {
				return abs
			}
			return candidate
		}
	}
	return "../data/jodi/oil"
}

func listJODIFiles(dir, glob string) ([]string, error) {
	if glob == "" {
		glob = "*.csv"
	}
	files, err := filepath.Glob(filepath.Join(dir, glob))
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	return files, nil
}

func fingerprintFile(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	buf := make([]byte, 1024*1024)
	var lines int64
	for {
		n, readErr := f.Read(buf)
		if n > 0 {
			chunk := buf[:n]
			_, _ = h.Write(chunk)
			lines += int64(bytes.Count(chunk, []byte{'\n'}))
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return "", 0, readErr
		}
	}
	rowCount := lines
	if rowCount > 0 {
		rowCount--
	}
	return hex.EncodeToString(h.Sum(nil)), rowCount, nil
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func formatMonth(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format("2006-01")
}
