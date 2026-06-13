package markets

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuri/excelize/v2"
)

const (
	WorldBankPinkSheetSourceKey  = "world_bank_pink_sheet"
	WorldBankPinkSheetDefaultURL = "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx"
)

type WorldBankPriceObservation struct {
	BenchmarkKey string
	Benchmark    string
	ProductCode  string
	Price        float64
	Currency     string
	Unit         string
	ObservedAt   time.Time
	RawUnit      string
}

type WorldBankWorkbookMeta struct {
	UpdatedLabel string
	ReleaseDate  time.Time
	RowCount     int64
}

type worldBankBenchmarkMeta struct {
	Key         string
	ProductCode string
}

var worldBankEnergyBenchmarks = map[string]worldBankBenchmarkMeta{
	"Crude oil, average":           {Key: "WB_CRUDE_AVG", ProductCode: "CRUDEOIL"},
	"Crude oil, Brent":             {Key: "BRENT", ProductCode: "CRUDEOIL"},
	"Crude oil, Dubai":             {Key: "WB_DUBAI", ProductCode: "CRUDEOIL"},
	"Crude oil, WTI":               {Key: "WTI", ProductCode: "CRUDEOIL"},
	"Natural gas, US":              {Key: "WB_NG_US", ProductCode: "GAS"},
	"Natural gas, Europe":          {Key: "WB_NG_EU", ProductCode: "GAS"},
	"Liquefied natural gas, Japan": {Key: "WB_LNG_JP", ProductCode: "LNG"},
	"Natural gas index":            {Key: "WB_NG_INDEX", ProductCode: "GAS"},
}

// ParseWorldBankMonthlyPrices reads the World Bank Pink Sheet monthly workbook.
// The workbook layout is: commodity labels row, units row, then YYYYMmm rows.
func ParseWorldBankMonthlyPrices(r io.Reader) ([]WorldBankPriceObservation, WorldBankWorkbookMeta, error) {
	f, err := excelize.OpenReader(r)
	if err != nil {
		return nil, WorldBankWorkbookMeta{}, fmt.Errorf("open world bank xlsx: %w", err)
	}
	defer f.Close()
	rows, err := f.GetRows("Monthly Prices")
	if err != nil {
		return nil, WorldBankWorkbookMeta{}, fmt.Errorf("read monthly prices sheet: %w", err)
	}
	if len(rows) < 7 {
		return nil, WorldBankWorkbookMeta{}, fmt.Errorf("monthly prices sheet too short")
	}
	meta := WorldBankWorkbookMeta{}
	for _, row := range rows[:min(len(rows), 6)] {
		if len(row) == 0 {
			continue
		}
		if strings.HasPrefix(strings.TrimSpace(row[0]), "Updated on ") {
			meta.UpdatedLabel = strings.TrimSpace(row[0])
			if parsed, err := time.Parse("January 02, 2006", strings.TrimPrefix(meta.UpdatedLabel, "Updated on ")); err == nil {
				meta.ReleaseDate = parsed.UTC()
			}
		}
	}
	headerIdx := -1
	for i, row := range rows {
		if len(row) > 4 && strings.EqualFold(strings.TrimSpace(row[1]), "Crude oil, average") {
			headerIdx = i
			break
		}
	}
	if headerIdx < 0 || headerIdx+1 >= len(rows) {
		return nil, meta, fmt.Errorf("monthly prices header not found")
	}
	labels := rows[headerIdx]
	units := rows[headerIdx+1]
	out := []WorldBankPriceObservation{}
	for _, row := range rows[headerIdx+2:] {
		if len(row) == 0 {
			continue
		}
		observedAt, err := parseWorldBankMonth(row[0])
		if err != nil {
			continue
		}
		meta.RowCount++
		for col := 1; col < len(labels); col++ {
			label := strings.TrimSpace(labels[col])
			bench, ok := worldBankEnergyBenchmarks[label]
			if !ok {
				continue
			}
			if col >= len(row) {
				continue
			}
			price, ok := parseWorldBankPrice(row[col])
			if !ok || price <= 0 {
				continue
			}
			rawUnit := ""
			if col < len(units) {
				rawUnit = strings.TrimSpace(units[col])
			}
			out = append(out, WorldBankPriceObservation{
				BenchmarkKey: bench.Key,
				Benchmark:    label,
				ProductCode:  bench.ProductCode,
				Price:        price,
				Currency:     "USD",
				Unit:         normalizeWorldBankUnit(rawUnit),
				ObservedAt:   observedAt,
				RawUnit:      rawUnit,
			})
		}
	}
	if len(out) == 0 {
		return nil, meta, fmt.Errorf("world bank workbook contained no mapped energy benchmark rows")
	}
	return out, meta, nil
}

func PersistWorldBankMonthlyPrices(ctx context.Context, pool *pgxpool.Pool, sourceURL string, client *http.Client) (int, error) {
	if pool == nil {
		return 0, fmt.Errorf("pool required")
	}
	if strings.TrimSpace(sourceURL) == "" {
		sourceURL = WorldBankPinkSheetDefaultURL
	}
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return 0, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("world bank pink sheet status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, err
	}
	sum := sha256.Sum256(body)
	checksum := hex.EncodeToString(sum[:])
	observations, meta, err := ParseWorldBankMonthlyPrices(bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	metaJSON, _ := json.Marshal(map[string]any{
		"updated_label": meta.UpdatedLabel,
		"observations":  len(observations),
		"source_url":    sourceURL,
	})
	latestByBenchmark := map[string]time.Time{}
	for _, obs := range observations {
		if obs.BenchmarkKey == "" {
			continue
		}
		if obs.ObservedAt.After(latestByBenchmark[obs.BenchmarkKey]) {
			latestByBenchmark[obs.BenchmarkKey] = obs.ObservedAt
		}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var sourceID uuid.UUID
	_ = tx.QueryRow(ctx, `
		INSERT INTO sources (source_name, slug, source_type, source_category, license, commercial_use_ok, reliability_score)
		VALUES ('World Bank Commodity Markets Pink Sheet', 'world_bank_pink_sheet', 'xlsx', 'market_data', 'World Bank open data terms', true, 85)
		ON CONFLICT (source_name) DO UPDATE SET slug = EXCLUDED.slug
		RETURNING id
	`).Scan(&sourceID)

	var releaseID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO data_source_releases (
			source_key, source_name, source_type, path, checksum, row_count, release_version,
			release_date, attribution, license, commercial_use_ok, import_status, imported_at, metadata
		)
		VALUES (
			$1, 'World Bank Commodity Price Data (The Pink Sheet)', 'xlsx', $2, $3, $4, $5,
			NULLIF($6::date, DATE '0001-01-01'), 'Source: World Bank Commodity Markets Pink Sheet',
			'World Bank open data terms', true, 'completed', now(), $7
		)
		ON CONFLICT (source_key, checksum)
		DO UPDATE SET import_status = 'completed', imported_at = now(), row_count = EXCLUDED.row_count,
			path = EXCLUDED.path, metadata = EXCLUDED.metadata, updated_at = now()
		RETURNING id
	`, WorldBankPinkSheetSourceKey, sourceURL, checksum, int64(len(observations)), meta.UpdatedLabel, meta.ReleaseDate, metaJSON).Scan(&releaseID)
	if err != nil {
		return 0, err
	}

	written := 0
	for _, obs := range observations {
		raw, _ := json.Marshal(map[string]any{
			"benchmark":     obs.Benchmark,
			"benchmark_key": obs.BenchmarkKey,
			"raw_unit":      obs.RawUnit,
			"updated_label": meta.UpdatedLabel,
			"source_url":    sourceURL,
		})
		tag, err := tx.Exec(ctx, `
			INSERT INTO market_price_observations (
				source_key, benchmark_key, product_code, country_code, price, currency, unit,
				observed_at, evidence_label, confidence_score, source_release_id, raw_payload
			)
			VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,'observed',0.86,$8,$9)
			ON CONFLICT (source_key, benchmark_key, product_code, country_code, observed_at)
			DO UPDATE SET price = EXCLUDED.price, currency = EXCLUDED.currency, unit = EXCLUDED.unit,
				source_release_id = EXCLUDED.source_release_id, raw_payload = EXCLUDED.raw_payload
		`, WorldBankPinkSheetSourceKey, obs.BenchmarkKey, obs.ProductCode, obs.Price, obs.Currency, obs.Unit, obs.ObservedAt, releaseID, raw)
		if err != nil {
			return written, err
		}
		written += int(tag.RowsAffected())
		if sourceID != uuid.Nil && obs.ObservedAt.Equal(latestByBenchmark[obs.BenchmarkKey]) {
			if err := upsertWorldBankLegacyPrice(ctx, tx, sourceID, obs, raw); err != nil {
				return written, err
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return written, err
	}
	return written, nil
}

func upsertWorldBankLegacyPrice(ctx context.Context, tx pgx.Tx, sourceID uuid.UUID, obs WorldBankPriceObservation, raw []byte) error {
	if obs.BenchmarkKey == "" {
		return nil
	}
	tag, err := tx.Exec(ctx, `
		UPDATE prices
		SET price = $3, currency = $4, unit = $5, source_id = $6, confidence_score = 86, raw_payload = $7
		WHERE location_name = $1 AND price_type = 'world_bank_monthly' AND observed_at = $2
	`, obs.BenchmarkKey, obs.ObservedAt, obs.Price, obs.Currency, obs.Unit, sourceID, raw)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO prices (location_name, price, currency, unit, price_type, observed_at, source_id, confidence_score, raw_payload)
		VALUES ($1,$2,$3,$4,'world_bank_monthly',$5,$6,86,$7)
	`, obs.BenchmarkKey, obs.Price, obs.Currency, obs.Unit, obs.ObservedAt, sourceID, raw)
	return err
}

func parseWorldBankMonth(raw string) (time.Time, error) {
	parts := strings.Split(strings.TrimSpace(raw), "M")
	if len(parts) != 2 {
		return time.Time{}, fmt.Errorf("invalid world bank month %q", raw)
	}
	year, err := strconv.Atoi(parts[0])
	if err != nil {
		return time.Time{}, err
	}
	month, err := strconv.Atoi(parts[1])
	if err != nil {
		return time.Time{}, err
	}
	if month < 1 || month > 12 {
		return time.Time{}, fmt.Errorf("invalid month %d", month)
	}
	return time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC), nil
}

func parseWorldBankPrice(raw string) (float64, bool) {
	s := strings.TrimSpace(strings.ReplaceAll(raw, ",", ""))
	if s == "" || s == "…" || s == "..." || strings.EqualFold(s, "na") {
		return 0, false
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

func normalizeWorldBankUnit(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "($")
	s = strings.TrimPrefix(s, "(")
	s = strings.TrimSuffix(s, ")")
	s = strings.TrimSpace(s)
	switch strings.ToLower(s) {
	case "/bbl":
		return "/bbl"
	case "/mmbtu":
		return "/mmbtu"
	case "2010=100":
		return "index_2010_100"
	default:
		if s == "" {
			return "unknown"
		}
		if strings.HasPrefix(s, "/") {
			return s
		}
		return s
	}
}
