package graphsync

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	eurostatDefaultHS     = "2709"
	eurostatDefaultHSDesc = "Petroleum oils, crude (Eurostat macro)"
	eurostatValueCap      = 500
)

var (
	eurostatYearRE = regexp.MustCompile(`(20\d{2}|19\d{2})`)
	eurostatHSRE   = regexp.MustCompile(`\b(\d{4,6})\b`)
)

// EurostatSyncResult mirrors Python sync_eurostat_hs27 payload.
type EurostatSyncResult struct {
	Status       string `json:"status"`
	RowsUpserted int    `json:"rows_upserted,omitempty"`
	DataSource   string `json:"data_source,omitempty"`
	Reason       string `json:"reason,omitempty"`
	Error        string `json:"error,omitempty"`
	Note         string `json:"note,omitempty"`
}

type eurostatMacroRow struct {
	Reporter      string
	ReporterISO2  string
	Partner       string
	HSCode        string
	HSDescription string
	FlowType      string
	Year          int
	TradeValueUSD float64
	EurostatKey   string
	Dimensions    map[string]string
}

func eurostatEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("EUROSTAT_SYNC_ENABLED")))
	if v == "0" || v == "false" || v == "no" || v == "off" {
		return false
	}
	return true
}

func eurostatDataset() string {
	if v := strings.TrimSpace(os.Getenv("EUROSTAT_DATASET")); v != "" {
		return v
	}
	return "EXT_LT_INTRATRD"
}

// SyncEurostatTrade fetches Eurostat JSON-stat and upserts macro rows into oil_trade_flows.
func SyncEurostatTrade(ctx context.Context, pool *pgxpool.Pool) (EurostatSyncResult, error) {
	if !eurostatEnabled() {
		result := EurostatSyncResult{Status: "skipped", Reason: "EUROSTAT_SYNC_ENABLED is off"}
		_ = recordEurostatSync(ctx, pool, result)
		return result, nil
	}

	dataset := eurostatDataset()
	url := fmt.Sprintf(
		"https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/%s?format=JSON&lang=en&lastTimePeriod=3",
		dataset,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return EurostatSyncResult{}, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		result := EurostatSyncResult{Status: "skipped", Error: err.Error(), Note: "Eurostat API unreachable"}
		_ = recordEurostatSync(ctx, pool, result)
		return result, nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		result := EurostatSyncResult{Status: "skipped", Error: err.Error(), Note: "Eurostat API unreachable"}
		_ = recordEurostatSync(ctx, pool, result)
		return result, nil
	}
	if resp.StatusCode >= 400 {
		result := EurostatSyncResult{
			Status: "skipped",
			Error:  fmt.Sprintf("HTTP %d", resp.StatusCode),
			Note:   "Eurostat API unreachable",
		}
		_ = recordEurostatSync(ctx, pool, result)
		return result, nil
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		result := EurostatSyncResult{Status: "skipped", Error: err.Error(), Note: "invalid Eurostat JSON"}
		_ = recordEurostatSync(ctx, pool, result)
		return result, nil
	}

	rows := parseEurostatJSON(payload)
	if len(rows) == 0 {
		result := EurostatSyncResult{Status: "skipped", Note: "no parseable Eurostat rows"}
		_ = recordEurostatSync(ctx, pool, result)
		return result, nil
	}

	written, err := upsertEurostatRows(ctx, pool, rows)
	if err != nil {
		return EurostatSyncResult{}, err
	}

	result := EurostatSyncResult{Status: "ok", RowsUpserted: written, DataSource: "eurostat"}
	_ = recordEurostatSync(ctx, pool, result)
	return result, nil
}

func recordEurostatSync(ctx context.Context, pool *pgxpool.Pool, result EurostatSyncResult) error {
	if pool == nil {
		return nil
	}
	step := map[string]any{
		"status": result.Status,
	}
	if result.RowsUpserted > 0 {
		step["rows_upserted"] = result.RowsUpserted
	}
	if result.DataSource != "" {
		step["data_source"] = result.DataSource
	}
	if result.Reason != "" {
		step["reason"] = result.Reason
	}
	if result.Error != "" {
		step["error"] = result.Error
	}
	if result.Note != "" {
		step["note"] = result.Note
	}
	return RecordSyncStep(ctx, pool, "last_eurostat_sync", step)
}

func upsertEurostatRows(ctx context.Context, pool *pgxpool.Pool, rows []eurostatMacroRow) (int, error) {
	written := 0
	for _, row := range rows {
		reporterM49, partnerM49 := eurostatM49Codes(row)
		flowType := row.FlowType
		if flowType == "" {
			flowType = "M"
		}
		flowType = strings.ToUpper(flowType[:1])
		year := row.Year
		if year == 0 {
			year = 2023
		}
		value := row.TradeValueUSD
		raw := map[string]any{
			"eurostat_key": row.EurostatKey,
			"dimensions":   row.Dimensions,
		}
		rawJSON, _ := json.Marshal(raw)

		tag, err := pool.Exec(ctx, `
			INSERT INTO oil_trade_flows (
				reporter, reporter_m49, reporter_iso2, partner, partner_m49,
				hs_code, hs_description, flow_type, year,
				trade_value_usd, data_source, raw
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'eurostat',$11::jsonb)
			ON CONFLICT (reporter_m49, partner_m49, hs_code, flow_type, year, data_source)
			DO UPDATE SET
				trade_value_usd = EXCLUDED.trade_value_usd,
				raw = EXCLUDED.raw,
				ingested_at = CURRENT_TIMESTAMP
		`, row.Reporter, reporterM49, row.ReporterISO2, row.Partner, partnerM49,
			row.HSCode, row.HSDescription, flowType, year, int64(value), rawJSON)
		if err != nil {
			return written, err
		}
		if tag.RowsAffected() > 0 {
			written++
		}
	}
	return written, nil
}

func eurostatM49Codes(row eurostatMacroRow) (string, string) {
	reporterM49 := "EU27"
	if geo, ok := row.Dimensions["geo"]; ok && geo != "" {
		reporterM49 = geo[:min(10, len(geo))]
	} else if row.ReporterISO2 != "" {
		reporterM49 = row.ReporterISO2[:min(10, len(row.ReporterISO2))]
	}
	partnerM49 := strings.TrimSpace(row.Dimensions["partner"])
	if partnerM49 == "" {
		partner := strings.TrimSpace(row.Partner)
		switch strings.ToLower(partner) {
		case "extra-eu", "world":
			partnerM49 = "0"
		default:
			compact := strings.ReplaceAll(partner, " ", "")
			if len(compact) <= 10 && compact != "" {
				partnerM49 = compact[:min(10, len(compact))]
			} else {
				partnerM49 = "XEU"
			}
		}
	}
	if len(partnerM49) > 10 {
		partnerM49 = partnerM49[:10]
	}
	return reporterM49, partnerM49
}

func parseEurostatJSON(payload map[string]any) []eurostatMacroRow {
	value, ok := payload["value"].(map[string]any)
	if !ok || len(value) == 0 {
		return nil
	}
	dimIDs, _ := payload["id"].([]any)
	sizes, _ := payload["size"].([]any)
	dimensions, _ := payload["dimension"].(map[string]any)
	if len(dimIDs) > 0 && len(sizes) == len(dimIDs) && dimensions != nil {
		if rows := parseEurostatDimensional(dimIDs, sizes, dimensions, value); len(rows) > 0 {
			return rows
		}
	}
	return parseEurostatFlat(value)
}

func parseEurostatFlat(value map[string]any) []eurostatMacroRow {
	out := make([]eurostatMacroRow, 0, eurostatValueCap)
	count := 0
	for key, val := range value {
		if count >= eurostatValueCap {
			break
		}
		num, ok := toFloat(val)
		if !ok {
			continue
		}
		out = append(out, eurostatMacroRow{
			Reporter:      "European Union",
			ReporterISO2:  "EU",
			Partner:       "Extra-EU",
			HSCode:        eurostatDefaultHS,
			HSDescription: eurostatDefaultHSDesc,
			FlowType:      "M",
			Year:          2023,
			TradeValueUSD: num * 1000,
			EurostatKey:   key,
		})
		count++
	}
	return out
}

func parseEurostatDimensional(
	dimIDs []any,
	sizes []any,
	dimensions map[string]any,
	value map[string]any,
) []eurostatMacroRow {
	intSizes := make([]int, len(sizes))
	for i, s := range sizes {
		switch v := s.(type) {
		case float64:
			intSizes[i] = int(v)
		case int:
			intSizes[i] = v
		default:
			return nil
		}
	}

	dimCodes := make([][]string, len(dimIDs))
	dimLabels := make([]map[string]string, len(dimIDs))
	dimRoles := make([]string, len(dimIDs))
	for i, rawID := range dimIDs {
		dimID, _ := rawID.(string)
		entry, _ := dimensions[dimID].(map[string]any)
		codes := sortedCategoryCodes(entry)
		if len(codes) == 0 {
			return nil
		}
		dimCodes[i] = codes
		dimLabels[i] = categoryLabels(entry)
		dimRoles[i] = eurostatDimRole(dimID)
	}

	out := make([]eurostatMacroRow, 0, eurostatValueCap)
	count := 0
	for key, val := range value {
		if count >= eurostatValueCap {
			break
		}
		num, ok := toFloat(val)
		if !ok {
			continue
		}
		flatKey := strings.Split(key, ":")[0]
		flat, err := strconv.Atoi(flatKey)
		if err != nil {
			continue
		}
		coords := coordsFromFlatIndex(flat, intSizes)
		dimValues := map[string]string{}
		reporter := "European Union"
		reporterISO2 := "EU"
		partner := "Extra-EU"
		hsCode := eurostatDefaultHS
		hsDesc := eurostatDefaultHSDesc
		flowType := "M"
		year := 0

		for i, rawID := range dimIDs {
			dimID, _ := rawID.(string)
			code := dimCodes[i][coords[i]]
			label := dimLabels[i][code]
			dimValues[dimID] = code
			switch dimRoles[i] {
			case "reporter":
				if label != "" {
					reporter = label
				} else {
					reporter = code
				}
				if iso := reporterISO2FromCode(code); iso != "" {
					reporterISO2 = iso
				}
			case "partner":
				if label != "" {
					partner = label
				} else {
					partner = code
				}
			case "year":
				year = parseEurostatYear(code, label)
			case "hs":
				hsCode = parseEurostatHS(code, label)
				if label != "" {
					hsDesc = label
				} else {
					hsDesc = fmt.Sprintf("Eurostat product %s", hsCode)
				}
			case "flow":
				flowType = parseEurostatFlow(code, label)
			}
		}

		if year == 0 {
			year = 2023
		}
		out = append(out, eurostatMacroRow{
			Reporter:      reporter,
			ReporterISO2:  reporterISO2,
			Partner:       partner,
			HSCode:        hsCode,
			HSDescription: hsDesc,
			FlowType:      flowType,
			Year:          year,
			TradeValueUSD: num * 1000,
			EurostatKey:   key,
			Dimensions:    dimValues,
		})
		count++
	}
	return out
}

func eurostatDimRole(dimID string) string {
	key := strings.ToLower(strings.TrimSpace(dimID))
	switch key {
	case "geo", "reporter", "rep", "reporter_iso", "geopolitical_entity":
		return "reporter"
	case "partner", "part", "partner_geo", "partner_country":
		return "partner"
	case "time", "time_period", "period":
		return "year"
	case "flow", "indic", "indic_et", "trade_flow", "indicators":
		return "flow"
	case "product", "hs", "hs6", "hs4", "sitc", "cpa", "prod", "commodity", "nomenclature":
		return "hs"
	default:
		if strings.HasPrefix(key, "hs") || strings.HasPrefix(key, "sitc") || strings.HasPrefix(key, "cpa") || strings.HasPrefix(key, "prod_") {
			return "hs"
		}
		return "other"
	}
}

func sortedCategoryCodes(entry map[string]any) []string {
	category, _ := entry["category"].(map[string]any)
	index, _ := category["index"].(map[string]any)
	if len(index) == 0 {
		return nil
	}
	type pair struct {
		code  string
		order float64
	}
	pairs := make([]pair, 0, len(index))
	for code, ord := range index {
		switch v := ord.(type) {
		case float64:
			pairs = append(pairs, pair{code: code, order: v})
		case int:
			pairs = append(pairs, pair{code: code, order: float64(v)})
		}
	}
	for i := 0; i < len(pairs); i++ {
		for j := i + 1; j < len(pairs); j++ {
			if pairs[j].order < pairs[i].order {
				pairs[i], pairs[j] = pairs[j], pairs[i]
			}
		}
	}
	out := make([]string, len(pairs))
	for i, p := range pairs {
		out[i] = p.code
	}
	return out
}

func categoryLabels(entry map[string]any) map[string]string {
	category, _ := entry["category"].(map[string]any)
	raw, _ := category["label"].(map[string]any)
	out := make(map[string]string, len(raw))
	for k, v := range raw {
		if s, ok := v.(string); ok {
			out[k] = s
		}
	}
	return out
}

func coordsFromFlatIndex(flat int, sizes []int) []int {
	coords := make([]int, len(sizes))
	for i := len(sizes) - 1; i >= 0; i-- {
		coords[i] = flat % sizes[i]
		flat /= sizes[i]
	}
	return coords
}

func parseEurostatYear(code, label string) int {
	for _, candidate := range []string{code, label} {
		if m := eurostatYearRE.FindStringSubmatch(candidate); len(m) > 1 {
			if y, err := strconv.Atoi(m[1]); err == nil {
				return y
			}
		}
	}
	return 0
}

func parseEurostatHS(code, label string) string {
	for _, candidate := range []string{code, label} {
		if m := eurostatHSRE.FindStringSubmatch(candidate); len(m) > 1 {
			hs := m[1]
			if len(hs) > 6 {
				hs = hs[:6]
			}
			return hs
		}
	}
	if len(strings.TrimSpace(code)) >= 4 && regexp.MustCompile(`^\d{4,6}$`).MatchString(strings.TrimSpace(code)) {
		hs := strings.TrimSpace(code)
		if len(hs) > 6 {
			hs = hs[:6]
		}
		return hs
	}
	return eurostatDefaultHS
}

func parseEurostatFlow(code, label string) string {
	text := strings.ToUpper(code + " " + label)
	if strings.Contains(text, "EXP") || strings.TrimSpace(code) == "X" || strings.TrimSpace(code) == "2" {
		return "X"
	}
	return "M"
}

func reporterISO2FromCode(code string) string {
	c := strings.ToUpper(strings.TrimSpace(code))
	if strings.HasPrefix(c, "EU") {
		return "EU"
	}
	if len(c) == 2 && regexp.MustCompile(`^[A-Z]{2}$`).MatchString(c) {
		return c
	}
	if len(c) >= 4 && regexp.MustCompile(`^[A-Z]{2}`).MatchString(c) {
		return c[:2]
	}
	return ""
}

func toFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(t, 64)
		return f, err == nil
	default:
		return 0, false
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
