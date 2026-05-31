package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

type SwedenSGUSync struct {
	Pool *pgxpool.Pool
}

func (s *SwedenSGUSync) RunOnce(ctx context.Context) error {
	enabled := strings.ToLower(strings.TrimSpace(os.Getenv("SGU_MINING_SYNC_ENABLED")))
	if enabled == "0" || enabled == "false" || enabled == "no" || enabled == "off" {
		log.Info().Msg("[sweden-mining-worker] idle: SGU_MINING_SYNC_ENABLED is off")
		return nil
	}

	log.Info().Msg("[sweden-mining-worker] starting SGU OGC mineral permits sync…")

	collections := []string{
		"bearbetningskoncessioner-ansokta",
		"bearbetningskoncessioner-beviljade",
		"markanvisningar-bk-ansokta",
		"markanvisningar-bk-beviljade",
		"ut-metaller-industrimineral-ansokta",
		"ut-metaller-industrimineral-beviljade",
		"ut-diamant-ansokta",
		"ut-diamant-beviljade",
	}

	maxPerCollection := 1500
	if envMax := os.Getenv("SGU_SYNC_MAX_PER_COLLECTION"); envMax != "" {
		if v, err := strconv.Atoi(envMax); err == nil {
			maxPerCollection = v
		}
	}
	pageLimit := 200
	if envPage := os.Getenv("SGU_SYNC_PAGE_LIMIT"); envPage != "" {
		if v, err := strconv.Atoi(envPage); err == nil {
			pageLimit = v
		}
	}

	baseURL := os.Getenv("SGU_OGC_BASE_URL")
	if baseURL == "" {
		baseURL = "https://api.sgu.se/oppnadata/mineralrattigheter/ogc/features/v1"
	}

	var allRecords []map[string]any

	for _, coll := range collections {
		offset := 0
		fetched := 0

		for fetched < maxPerCollection {
			limit := pageLimit
			if fetched+limit > maxPerCollection {
				limit = maxPerCollection - fetched
			}

			url := fmt.Sprintf("%s/collections/%s/items?limit=%d&f=json&offset=%d", baseURL, coll, limit, offset)
			client := &http.Client{Timeout: 10 * time.Second}
			req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
			if err != nil {
				log.Error().Err(err).Str("collection", coll).Msg("failed to create request")
				break
			}
			req.Header.Set("User-Agent", "meridian-platform/1.0 (Mining Map Backend)")

			resp, err := client.Do(req)
			if err != nil {
				log.Error().Err(err).Str("collection", coll).Msg("failed to fetch")
				break
			}
			defer resp.Body.Close()

			if resp.StatusCode != 200 {
				log.Error().Int("status", resp.StatusCode).Str("collection", coll).Msg("non-200 response")
				break
			}

			body, _ := io.ReadAll(resp.Body)
			var data struct {
				Features []map[string]any `json:"features"`
			}
			if err := json.Unmarshal(body, &data); err != nil {
				log.Error().Err(err).Str("collection", coll).Msg("failed to unmarshal JSON")
				break
			}

			if len(data.Features) == 0 {
				break
			}

			for _, f := range data.Features {
				rec := s.normalizeSGUFeature(coll, f)
				if rec != nil {
					allRecords = append(allRecords, rec)
				}
			}

			fetched += len(data.Features)
			offset += len(data.Features)
		}
	}

	// Dedup and UPSERT
	deduped := make(map[string]map[string]any)
	for _, rec := range allRecords {
		if id, ok := rec["id"].(string); ok {
			deduped[id] = rec
		}
	}

	if len(deduped) == 0 {
		return nil
	}

	return s.upsertRecords(ctx, deduped)
}

func (s *SwedenSGUSync) normalizeSGUFeature(collection string, feature map[string]any) map[string]any {
	props, ok := feature["properties"].(map[string]any)
	if !ok || props == nil {
		return nil
	}

	var rawID string
	if extID, ok := props["arendenummer"].(string); ok && extID != "" {
		rawID = extID
	} else if objID, ok := props["objectid"].(float64); ok {
		rawID = fmt.Sprintf("obj_%.0f", objID)
	} else {
		return nil
	}

	idStr := fmt.Sprintf("sweden_sgu_%s_%s", collection, rawID)
	id := uuid.NewMD5(uuid.NameSpaceURL, []byte(idStr)).String()

	company := "Unknown SGU Operator"
	if inv, ok := props["innehavare"].(string); ok && inv != "" {
		company = inv
	} else if sok, ok := props["sokande"].(string); ok && sok != "" {
		company = sok
	}

	status := "Application"
	if strings.Contains(collection, "beviljade") {
		status = "Operating"
	}

	lType := "Exploration"
	if strings.Contains(collection, "bearbetningskoncessioner") {
		lType = "Mining"
	}

	var lat, lng *float64
	if geom, ok := feature["geometry"].(map[string]any); ok {
		if t, ok := geom["type"].(string); ok && t == "Point" {
			if coords, ok := geom["coordinates"].([]any); ok && len(coords) >= 2 {
				if x, ok := coords[0].(float64); ok {
					if y, ok := coords[1].(float64); ok {
						lng = &x
						lat = &y
					}
				}
			}
		}
	}

	var dIssued *time.Time
	if bd, ok := props["beslutsdatum"].(string); ok && bd != "" {
		if parsed, err := time.Parse("2006-01-02", bd[:10]); err == nil {
			dIssued = &parsed
		}
	}

	var commodity string
	if mineral, ok := props["mineral"].(string); ok && mineral != "" {
		commodity = mineral
	} else if typ, ok := props["typ"].(string); ok && typ != "" {
		commodity = typ
	}

	rawPayload, _ := json.Marshal(feature)

	return map[string]any{
		"id":                id,
		"company":           company,
		"country":           "Sweden",
		"region":            "Sweden",
		"commodity":         commodity,
		"license_type":      lType,
		"status":            status,
		"lat":               lat,
		"lng":               lng,
		"date_issued":       dIssued,
		"sector":            "metals_and_minerals",
		"record_origin":     "open_data",
		"source_id":         fmt.Sprintf("sweden_sgu_%s", collection),
		"source_name":       "SGU mineral permits (OGC API Features)",
		"source_url":        "https://api.sgu.se/",
		"source_record_url": "",
		"source_updated_at": time.Now(),
		"raw_payload":       string(rawPayload),
	}
}

func (s *SwedenSGUSync) upsertRecords(ctx context.Context, records map[string]map[string]any) error {
	tx, err := s.Pool.Begin(ctx)
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
			log.Error().Err(err).Msg("failed to upsert record")
		}
	}

	return tx.Commit(ctx)
}

func StartSwedenSGUSyncLoop(ctx context.Context, pool *pgxpool.Pool) {
	worker := &SwedenSGUSync{Pool: pool}
	interval := 604800 // 7 days
	if envInt := os.Getenv("SGU_SYNC_INTERVAL_SECONDS"); envInt != "" {
		if v, err := strconv.Atoi(envInt); err == nil {
			interval = v
		}
	}
	backoff := 3600
	if envBackoff := os.Getenv("SGU_SYNC_BACKOFF_SECONDS"); envBackoff != "" {
		if v, err := strconv.Atoi(envBackoff); err == nil {
			backoff = v
		}
	}

	for {
		err := worker.RunOnce(ctx)
		if err != nil {
			log.Error().Err(err).Msg("[sweden-mining-worker] failed")
			time.Sleep(time.Duration(backoff) * time.Second)
		} else {
			time.Sleep(time.Duration(interval) * time.Second)
		}
	}
}
