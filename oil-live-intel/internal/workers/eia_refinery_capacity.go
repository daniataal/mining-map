package workers

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/rs/zerolog"
	"github.com/xuri/excelize/v2"
)

func StartEIARefineryCapacitySyncLoop(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	interval := 30 * 24 * time.Hour // Check monthly
	for {
		if err := runEIARefineryCapacitySync(ctx, pool, cfg, log); err != nil {
			log.Warn().Err(err).Msg("[eia-refinery] sync failed")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

func runEIARefineryCapacitySync(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) error {
	// Try downloading refcap25.xlsx (could be extended to dynamically find the latest)
	url := "https://www.eia.gov/petroleum/refinerycapacity/refcap25.xlsx"
	
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download EIA refinery capacity: HTTP %d", resp.StatusCode)
	}

	f, err := excelize.OpenReader(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to open excel file: %w", err)
	}
	defer f.Close()

	sheetName := "refcap25"
	rows, err := f.GetRows(sheetName)
	if err != nil {
		return fmt.Errorf("failed to get rows from %s: %w", sheetName, err)
	}

	if len(rows) < 2 {
		return fmt.Errorf("no data rows found in sheet")
	}

	header := rows[0]
	colIdx := make(map[string]int)
	for i, col := range header {
		colIdx[strings.TrimSpace(col)] = i
	}

	// Create import batch
	var batchID string
	err = pool.QueryRow(ctx, `
		INSERT INTO core_import_batches (source_key, batch_kind, source_uri, status, started_at)
		VALUES ('eia_refinery_capacity', 'scheduled', $1, 'running', now())
		RETURNING id::text
	`, url).Scan(&batchID)
	if err != nil {
		return err
	}

	var processed, upserted int
	for rIdx := 1; rIdx < len(rows); rIdx++ {
		row := rows[rIdx]
		getVal := func(col string) string {
			if idx, ok := colIdx[col]; ok && idx < len(row) {
				return strings.TrimSpace(row[idx])
			}
			return ""
		}

		product := getVal("PRODUCT")
		supply := getVal("SUPPLY")

		// We only want Operating Capacity (barrels per calendar day)
		if product != "OPERATING CAPACITY" || supply != "Atmospheric Crude Distillation Capacity (barrels per calendar day)" {
			continue
		}

		processed++
		corp := getVal("CORPORATION")
		operator := getVal("COMPANY_NAME")
		state := getVal("STATE_NAME")
		site := getVal("SITE")
		padd := getVal("PADD")
		qtyStr := getVal("QUANTITY")

		qty, _ := strconv.ParseFloat(qtyStr, 64)

		payload := map[string]interface{}{
			"corporation": corp,
			"operator":    operator,
			"state":       state,
			"site":        site,
			"padd":        padd,
			"quantity":    qty,
		}

		payloadBytes, _ := json.Marshal(payload)
		hashStr := fmt.Sprintf("%x", md5.Sum(payloadBytes))

		externalID := fmt.Sprintf("%s_%s_%s", state, site, corp)
		
		// Insert raw record
		var recordID string
		err = pool.QueryRow(ctx, `
			INSERT INTO core_source_records (source_key, import_batch_id, external_id, record_hash, source_url, sheet_name, row_number, raw_payload)
			VALUES ('eia_refinery_capacity', $1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (source_key, record_hash) DO UPDATE SET updated_at = now()
			RETURNING id::text
		`, batchID, externalID, hashStr, url, sheetName, rIdx, payloadBytes).Scan(&recordID)
		if err != nil {
			log.Warn().Err(err).Msg("failed to insert raw record")
			continue
		}

		// Normalize Owner
		ownerID, err := upsertOrganization(ctx, pool, corp, "US", recordID, "eia_refinery_capacity")
		if err != nil {
			log.Warn().Err(err).Msg("failed to upsert owner organization")
		}

		// Normalize Operator
		operatorID, err := upsertOrganization(ctx, pool, operator, "US", recordID, "eia_refinery_capacity")
		if err != nil {
			log.Warn().Err(err).Msg("failed to upsert operator organization")
		}

		// Upsert Asset
		assetName := fmt.Sprintf("%s %s Refinery", corp, site)
		assetID, err := upsertAsset(ctx, pool, assetName, "refinery", "US", state, padd, "oil_gas", qty, "B/CD", recordID, "eia_refinery_capacity", externalID)
		if err != nil {
			log.Warn().Err(err).Msg("failed to upsert asset")
			continue
		}

		// Link Owner and Operator
		if ownerID != "" && assetID != "" {
			_ = linkAssetOrg(ctx, pool, assetID, ownerID, "owner", recordID, "eia_refinery_capacity")
		}
		if operatorID != "" && assetID != "" && operatorID != ownerID {
			_ = linkAssetOrg(ctx, pool, assetID, operatorID, "operator", recordID, "eia_refinery_capacity")
		}

		upserted++
	}

	// Update batch
	_, _ = pool.Exec(ctx, `
		UPDATE core_import_batches
		SET status = 'completed', finished_at = now(), rows_seen = $1, rows_written = $2
		WHERE id = $3
	`, processed, upserted, batchID)

	log.Info().
		Int("processed", processed).
		Int("upserted", upserted).
		Msg("[eia-refinery] pass complete")

	return nil
}

func upsertOrganization(ctx context.Context, pool *pgxpool.Pool, name, country, recordID, sourceKey string) (string, error) {
	if name == "" {
		return "", nil
	}
	normalized := strings.Join(strings.Fields(strings.ToLower(name)), " ")
	
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO core_organizations (name, normalized_name, country, source_key, source_record_id, confidence)
		VALUES ($1, $2, $3, $4, $5, 0.9)
		ON CONFLICT (normalized_name, country) DO UPDATE SET
			name = COALESCE(NULLIF(core_organizations.name, ''), EXCLUDED.name),
			updated_at = now()
		RETURNING id::text
	`, name, normalized, country, sourceKey, recordID).Scan(&id)
	return id, err
}

func upsertAsset(ctx context.Context, pool *pgxpool.Pool, name, assetType, country, state, region, commodity string, capacity float64, unit, recordID, sourceKey, externalID string) (string, error) {
	normalized := strings.Join(strings.Fields(strings.ToLower(name)), " ")
	
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO core_assets (asset_type, name, normalized_name, country, region, commodity_family, capacity_value, capacity_unit, source_key, source_record_id, legacy_table, legacy_id, confidence)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'eia_refinery_capacity', $11, 0.9)
		ON CONFLICT (legacy_table, legacy_id) WHERE legacy_table IS NOT NULL AND legacy_id IS NOT NULL
		DO UPDATE SET
			capacity_value = EXCLUDED.capacity_value,
			capacity_unit = EXCLUDED.capacity_unit,
			region = EXCLUDED.region,
			updated_at = now()
		RETURNING id::text
	`, assetType, name, normalized, country, region, commodity, capacity, unit, sourceKey, recordID, externalID).Scan(&id)
	return id, err
}

func linkAssetOrg(ctx context.Context, pool *pgxpool.Pool, assetID, orgID, role, recordID, sourceKey string) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO core_asset_relationships (asset_id, organization_id, relationship_role, relationship_label, source_key, source_record_id, confidence, verification_status)
		VALUES ($1, $2, $3, $3, $4, $5, 0.9, 'source_backed')
		ON CONFLICT (asset_id, organization_id, relationship_role, (COALESCE(source_key, '')), (COALESCE(source_record_id::text, '')))
		DO UPDATE SET updated_at = now()
	`, assetID, orgID, role, sourceKey, recordID)
	return err
}
