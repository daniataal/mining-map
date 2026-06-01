package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

type KazakhstanEgovSync struct {
	Pool *pgxpool.Pool
}

func (k *KazakhstanEgovSync) RunOnce(ctx context.Context) error {
	apiKey := strings.TrimSpace(os.Getenv("KZ_EGOV_API_KEY"))
	if apiKey == "" {
		log.Info().Msg("[kazakhstan-mining-worker] idle: KZ_EGOV_API_KEY not configured")
		return nil
	}

	log.Info().Msg("[kazakhstan-mining-worker] starting egov.kz mining register sync…")

	apiBase := os.Getenv("KZ_EGOV_API_BASE")
	if apiBase == "" {
		apiBase = "https://data.egov.kz/api/v4"
	}
	datasetIndex := "reestr_vydannyh_licenzii_na_ne1"

	var allRecords []map[string]any
	maxRows := 5000
	pageSize := 500
	offset := 0

	client := &http.Client{Timeout: 60 * time.Second}

	for len(allRecords) < maxRows {
		source := fmt.Sprintf(`{"size":%d,"from":%d}`, pageSize, offset)
		u := fmt.Sprintf("%s/%s/v1?source=%s", apiBase, datasetIndex, url.QueryEscape(source))

		req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
		if err != nil {
			log.Error().Err(err).Msg("failed to create request for egov.kz")
			break
		}
		req.Header.Set("X-API-KEY", apiKey)
		req.Header.Set("Accept", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			log.Error().Err(err).Msg("failed to fetch from egov.kz")
			break
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			log.Error().Int("status", resp.StatusCode).Msg("non-200 response from egov.kz")
			break
		}

		body, _ := io.ReadAll(resp.Body)
		var payload any
		if err := json.Unmarshal(body, &payload); err != nil {
			log.Error().Err(err).Msg("failed to parse egov.kz JSON")
			break
		}

		var page []any
		if slice, ok := payload.([]any); ok {
			page = slice
		} else if m, ok := payload.(map[string]any); ok {
			for _, key := range []string{"data", "items", "hits", "results", "records"} {
				if block, exists := m[key]; exists {
					if slice, isSlice := block.([]any); isSlice {
						page = slice
						break
					}
				}
			}
		}

		if len(page) == 0 {
			break
		}

		for idx, rowRaw := range page {
			if len(allRecords) >= maxRows {
				break
			}
			if row, ok := rowRaw.(map[string]any); ok {
				rec := k.normalizeEgovRow(row, offset+idx)
				allRecords = append(allRecords, rec)
			}
		}

		if len(page) < pageSize {
			break
		}
		offset += pageSize
	}

	if len(allRecords) == 0 {
		return nil
	}

	return k.upsertRecords(ctx, allRecords)
}

func (k *KazakhstanEgovSync) normalizeEgovRow(raw map[string]any, fallbackIndex int) map[string]any {
	firstStr := func(keys []string) string {
		for _, key := range keys {
			if val, ok := raw[key]; ok && val != nil {
				strVal := strings.TrimSpace(fmt.Sprintf("%v", val))
				low := strings.ToLower(strVal)
				if strVal != "" && low != "null" && low != "none" && low != "nan" {
					return strVal
				}
			}
		}
		return ""
	}

	parseCoord := func(keys []string) *float64 {
		strVal := firstStr(keys)
		if strVal == "" {
			return nil
		}
		strVal = strings.ReplaceAll(strVal, ",", ".")
		f, err := strconv.ParseFloat(strVal, 64)
		if err == nil {
			return &f
		}
		return nil
	}

	parseCoordNested := func(nested map[string]any, keys []string) *float64 {
		for _, key := range keys {
			if val, ok := nested[key]; ok && val != nil {
				strVal := strings.TrimSpace(fmt.Sprintf("%v", val))
				strVal = strings.ReplaceAll(strVal, ",", ".")
				if f, err := strconv.ParseFloat(strVal, 64); err == nil {
					return &f
				}
			}
		}
		return nil
	}

	licNumKeys := []string{"licence_number", "license_number", "nomer_licenzii", "nomer_licenzii_na_pravo_polzovaniya", "license_no", "lic_no", "reg_number", "registration_number", "id"}
	holderKeys := []string{"holder", "nedropolzovatel", "company", "subsoil_user"}
	latKeys := []string{"latitude", "lat", "shirota", "geo_lat", "y"}
	lngKeys := []string{"longitude", "lng", "lon", "dolgota", "geo_lon", "x"}
	regionKeys := []string{"region", "oblast", "obl", "kato", "administrative_unit"}
	commodityKeys := []string{"commodity", "mineral", "poleznoe_iskopaemoe", "minerals", "resource"}
	statusKeys := []string{"status", "status_licenzii", "sostoyanie", "state"}
	licenseTypeKeys := []string{"license_type", "vid", "vid_licenzii", "type"}
	dateIssuedKeys := []string{"date_issued", "data_vydachi", "issue_date", "data_registracii"}

	licNum := firstStr(licNumKeys)
	if licNum == "" {
		licNum = fmt.Sprintf("kz_egov_%d", fallbackIndex)
	}
	company := firstStr(holderKeys)
	if company == "" {
		company = licNum
	}

	lat := parseCoord(latKeys)
	lng := parseCoord(lngKeys)

	if lat == nil || lng == nil {
		for _, nestedKey := range []string{"geo", "location", "coordinates", "geom"} {
			if nested, ok := raw[nestedKey].(map[string]any); ok {
				if lat == nil {
					lat = parseCoordNested(nested, latKeys)
				}
				if lng == nil {
					lng = parseCoordNested(nested, lngKeys)
				}
			}
		}
	}

	status := firstStr(statusKeys)
	if status == "" {
		status = "Active"
	}
	commodity := firstStr(commodityKeys)
	if commodity == "" {
		commodity = "Minerals"
	}
	licenseType := firstStr(licenseTypeKeys)
	if licenseType == "" {
		licenseType = "Mining licence"
	}

	var dIssued *time.Time
	if bd := firstStr(dateIssuedKeys); bd != "" {
		if parsed, err := time.Parse("2006-01-02", bd[:10]); err == nil {
			dIssued = &parsed
		} else if parsed, err := time.Parse("02.01.2006", bd[:10]); err == nil {
			dIssued = &parsed
		}
	}

	rawPayload, _ := json.Marshal(raw)

	return map[string]any{
		"id":                licNum,
		"company":           company,
		"country":           "Kazakhstan",
		"region":            firstStr(regionKeys),
		"commodity":         commodity,
		"license_type":      licenseType,
		"status":            status,
		"lat":               lat,
		"lng":               lng,
		"date_issued":       dIssued,
		"sector":            "metals_and_minerals",
		"record_origin":     "open_data",
		"source_id":         "kazakhstan_egov_mining_register",
		"source_name":       "Kazakhstan solid minerals licence register (data.egov.kz)",
		"source_url":        fmt.Sprintf("https://data.egov.kz/datasets/view?index=reestr_vydannyh_licenzii_na_ne1"),
		"source_record_url": "",
		"source_updated_at": time.Now(),
		"raw_payload":       string(rawPayload),
	}
}

func (k *KazakhstanEgovSync) upsertRecords(ctx context.Context, records []map[string]any) error {
	tx, err := k.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	sql := `
        INSERT INTO licenses (
            id, company, country, region, commodity, license_type, status,
            lat, lng, date_issued, sector, record_origin, source_id,
            source_name, source_url, source_record_url, source_updated_at, raw_payload, last_synced_at
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        ) ON CONFLICT (id) DO UPDATE SET
            company = EXCLUDED.company,
            country = EXCLUDED.country,
            region = EXCLUDED.region,
            commodity = EXCLUDED.commodity,
            license_type = EXCLUDED.license_type,
            status = EXCLUDED.status,
            lat = EXCLUDED.lat,
            lng = EXCLUDED.lng,
            date_issued = EXCLUDED.date_issued,
            sector = EXCLUDED.sector,
            record_origin = EXCLUDED.record_origin,
            source_id = EXCLUDED.source_id,
            source_name = EXCLUDED.source_name,
            source_url = EXCLUDED.source_url,
            source_record_url = EXCLUDED.source_record_url,
            source_updated_at = EXCLUDED.source_updated_at,
            raw_payload = EXCLUDED.raw_payload,
            last_synced_at = EXCLUDED.last_synced_at
    `

	now := time.Now()
	for _, rec := range records {
		_, err := tx.Exec(ctx, sql,
			rec["id"], rec["company"], rec["country"], rec["region"], rec["commodity"],
			rec["license_type"], rec["status"], rec["lat"], rec["lng"], rec["date_issued"],
			rec["sector"], rec["record_origin"], rec["source_id"], rec["source_name"],
			rec["source_url"], rec["source_record_url"], rec["source_updated_at"],
			rec["raw_payload"], now,
		)
		if err != nil {
			log.Error().Err(err).Str("id", rec["id"].(string)).Msg("failed to upsert record")
		}
	}

	return tx.Commit(ctx)
}

func StartKazakhstanEgovSyncLoop(ctx context.Context, pool *pgxpool.Pool) {
	worker := &KazakhstanEgovSync{Pool: pool}
	interval := 86400 // 1 day
	if envInt := os.Getenv("KZ_EGOV_SYNC_INTERVAL_SECONDS"); envInt != "" {
		if v, err := strconv.Atoi(envInt); err == nil {
			interval = v
		}
	}
	backoff := 3600
	if envBackoff := os.Getenv("KZ_EGOV_SYNC_BACKOFF_SECONDS"); envBackoff != "" {
		if v, err := strconv.Atoi(envBackoff); err == nil {
			backoff = v
		}
	}

	for {
		err := worker.RunOnce(ctx)
		if err != nil {
			log.Error().Err(err).Msg("[kazakhstan-mining-worker] failed")
			time.Sleep(time.Duration(backoff) * time.Second)
		} else {
			time.Sleep(time.Duration(interval) * time.Second)
		}
	}
}
