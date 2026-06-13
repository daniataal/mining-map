package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const gemOilFoundationJobType = "gem_oil_foundation"

type GEMOilFoundationOptions struct {
	Dir     string `json:"dir,omitempty"`
	MaxRows int    `json:"max_rows,omitempty"`
	Force   bool   `json:"force,omitempty"`
}

type GEMOilFoundationResult struct {
	Workbook       string `json:"workbook"`
	MainRows       int    `json:"main_rows"`
	Entities       int    `json:"entities"`
	OwnershipRows  int    `json:"ownership_rows"`
	ProductionRows int    `json:"production_rows"`
	ReserveRows    int    `json:"reserve_rows"`
	MatchedAssets  int    `json:"matched_assets"`
	DurationMillis int64  `json:"duration_ms"`
}

func (s *Service) processGEMOilFoundation(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := GEMOilFoundationOptions{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	res, err := s.ImportGEMOilFoundation(ctx, opts)
	report, _ := json.Marshal(res)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", report, err)
	}
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) ImportGEMOilFoundation(ctx context.Context, opts GEMOilFoundationOptions) (GEMOilFoundationResult, error) {
	started := time.Now()
	dir := opts.Dir
	if dir == "" {
		dir = locateGEMDataDir()
	}
	if dir == "" {
		return GEMOilFoundationResult{}, fmt.Errorf("GEM data dir not found")
	}
	path := filepath.Join(dir, "Global-Oil-and-Gas-Extraction-Tracker-March-2026.xlsx")
	res := GEMOilFoundationResult{Workbook: path}
	checksum, rowCount, err := fingerprintFile(path)
	if err != nil {
		return res, err
	}
	releaseID, skipped, err := s.prepareGEMSourceRelease(ctx, path, checksum, rowCount, opts.Force)
	if err != nil {
		return res, err
	}
	if skipped {
		res.DurationMillis = time.Since(started).Milliseconds()
		return res, nil
	}

	mainRows, err := readExcelSheet(path, "Field-level main data")
	if err != nil {
		_ = s.markSourceReleaseFailed(ctx, releaseID, err)
		return res, err
	}
	productionRows, err := readExcelSheet(path, "Field-level production data")
	if err != nil {
		_ = s.markSourceReleaseFailed(ctx, releaseID, err)
		return res, err
	}
	reserveRows, err := readExcelSheet(path, "Field-level reserves data")
	if err != nil {
		_ = s.markSourceReleaseFailed(ctx, releaseID, err)
		return res, err
	}
	if opts.MaxRows > 0 {
		mainRows = limitStringMaps(mainRows, opts.MaxRows)
		productionRows = limitStringMaps(productionRows, opts.MaxRows)
		reserveRows = limitStringMaps(reserveRows, opts.MaxRows)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return res, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	seenEntities := map[string]bool{}
	seenAssets := map[string]bool{}
	for _, row := range mainRows {
		unitID := gemCleanText(row["Unit ID"])
		if unitID == "" {
			continue
		}
		res.MainRows++
		assetID := uuid.Nil
		_ = tx.QueryRow(ctx, `
			SELECT id
			FROM assets
			WHERE legacy_table = 'gem_global_extraction_tracker'
			  AND legacy_id = $1
			LIMIT 1
		`, unitID).Scan(&assetID)
		if assetID != uuid.Nil && !seenAssets[assetID.String()] {
			seenAssets[assetID.String()] = true
			res.MatchedAssets++
		}
		operatorID := ""
		if operator := gemCleanText(row["Operator"]); operator != "" {
			operatorID, err = upsertGEMEntity(ctx, tx, operator, "operator", releaseID, map[string]any{
				"source_field": "Operator",
				"unit_id":      unitID,
			})
			if err != nil {
				return res, err
			}
			if !seenEntities[operatorID] {
				seenEntities[operatorID] = true
				res.Entities++
			}
		}
		parentID := ""
		parents := parseGEMOwnershipList(row["Parent(s)"])
		if len(parents) > 0 {
			parentID, err = upsertGEMEntity(ctx, tx, parents[0].Name, "parent", releaseID, map[string]any{
				"source_field": "Parent(s)",
				"unit_id":      unitID,
			})
			if err != nil {
				return res, err
			}
			if !seenEntities[parentID] {
				seenEntities[parentID] = true
				res.Entities++
			}
		}
		owners := parseGEMOwnershipList(row["Owner(s)"])
		if len(owners) == 0 && operatorID != "" {
			owners = []gemOwnershipName{{Name: row["Operator"]}}
		}
		for _, owner := range owners {
			ownerID, err := upsertGEMEntity(ctx, tx, owner.Name, "owner", releaseID, map[string]any{
				"source_field": "Owner(s)",
				"unit_id":      unitID,
			})
			if err != nil {
				return res, err
			}
			if !seenEntities[ownerID] {
				seenEntities[ownerID] = true
				res.Entities++
			}
			tag, err := tx.Exec(ctx, `
				INSERT INTO gem_asset_ownership (
					asset_id,
					gem_asset_id,
					gem_unit_id,
					asset_name,
					asset_type,
					country_code,
					operator_entity_id,
					owner_entity_id,
					parent_entity_id,
					share_pct,
					share_imputed,
					evidence_label,
					source_release_id,
					raw_payload
				)
				VALUES ($1,$2,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),$9,$10,'reported',$11,$12)
				ON CONFLICT DO NOTHING
			`, nullableUUID(assetID), unitID, gemCleanText(row["Unit Name"]), gemAssetTypeFromFuel(row["Fuel type"]), gemCountryCode(row["Country/Area"]),
				operatorID, ownerID, parentID, owner.SharePct, owner.SharePct == nil, releaseID, jsonMap(row))
			if err != nil {
				return res, err
			}
			res.OwnershipRows += int(tag.RowsAffected())
		}
	}

	for _, row := range productionRows {
		written, err := upsertGEMProductionFact(ctx, tx, row, releaseID)
		if err != nil {
			return res, err
		}
		res.ProductionRows += written
	}
	for _, row := range reserveRows {
		written, err := upsertGEMReserveFact(ctx, tx, row, releaseID)
		if err != nil {
			return res, err
		}
		res.ReserveRows += written
	}
	if err := backfillGEMFactAssetLinks(ctx, tx, releaseID); err != nil {
		return res, err
	}

	if err := tx.Commit(ctx); err != nil {
		return res, err
	}
	metadata, _ := json.Marshal(map[string]any{
		"main_rows":       res.MainRows,
		"entities":        res.Entities,
		"ownership_rows":  res.OwnershipRows,
		"production_rows": res.ProductionRows,
		"reserve_rows":    res.ReserveRows,
		"matched_assets":  res.MatchedAssets,
	})
	_, _ = s.pool.Exec(ctx, `
		UPDATE data_source_releases
		SET import_status = 'completed',
			imported_at = now(),
			metadata = $2,
			updated_at = now()
		WHERE id = $1
	`, releaseID, metadata)
	res.DurationMillis = time.Since(started).Milliseconds()
	return res, nil
}

func (s *Service) prepareGEMSourceRelease(ctx context.Context, path, checksum string, rowCount int64, force bool) (uuid.UUID, bool, error) {
	var existingID uuid.UUID
	var existingStatus string
	err := s.pool.QueryRow(ctx, `
		SELECT id, import_status
		FROM data_source_releases
		WHERE source_key = 'gem_goget_extraction' AND checksum = $1
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
			'gem_goget_extraction',
			'GEM Global Oil and Gas Extraction Tracker',
			'xlsx',
			$1,
			$2,
			$3,
			'March 2026',
			'Global Energy Monitor',
			'GEM public tracker; verify license terms before redistribution',
			true,
			'running',
			'{}'::jsonb
		)
		ON CONFLICT (source_key, checksum)
		DO UPDATE SET
			path = EXCLUDED.path,
			row_count = EXCLUDED.row_count,
			import_status = 'running',
			updated_at = now()
		RETURNING id
	`, path, checksum, rowCount).Scan(&releaseID)
	return releaseID, false, err
}

func backfillGEMFactAssetLinks(ctx context.Context, tx pgx.Tx, releaseID uuid.UUID) error {
	statements := []string{
		`
			UPDATE gem_asset_ownership g
			SET asset_id = a.id
			FROM assets a
			WHERE g.source_release_id = $1
			  AND g.asset_id IS NULL
			  AND a.legacy_table = 'gem_global_extraction_tracker'
			  AND a.legacy_id = g.gem_asset_id
		`,
		`
			UPDATE asset_production_facts f
			SET asset_id = a.id
			FROM assets a
			WHERE f.source_release_id = $1
			  AND f.asset_id IS NULL
			  AND a.legacy_table = 'gem_global_extraction_tracker'
			  AND a.legacy_id = f.gem_asset_id
		`,
		`
			UPDATE asset_reserve_facts f
			SET asset_id = a.id
			FROM assets a
			WHERE f.source_release_id = $1
			  AND f.asset_id IS NULL
			  AND a.legacy_table = 'gem_global_extraction_tracker'
			  AND a.legacy_id = f.gem_asset_id
		`,
	}
	for _, stmt := range statements {
		if _, err := tx.Exec(ctx, stmt, releaseID); err != nil {
			return err
		}
	}
	return nil
}

type gemOwnershipName struct {
	Name     string
	SharePct *float64
}

var gemShareRE = regexp.MustCompile(`\[(\d+(?:\.\d+)?)%\]`)

func parseGEMOwnershipList(raw string) []gemOwnershipName {
	raw = gemCleanText(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ";")
	out := make([]gemOwnershipName, 0, len(parts))
	for _, part := range parts {
		part = gemCleanText(part)
		if part == "" {
			continue
		}
		var share *float64
		if match := gemShareRE.FindStringSubmatch(part); len(match) == 2 {
			if f, err := strconv.ParseFloat(match[1], 64); err == nil {
				share = &f
			}
			part = gemShareRE.ReplaceAllString(part, "")
		}
		name := normalizeName(stripGEMOwnershipPct(part))
		if name == "" || isGEMUnknownCommercialName(name) {
			continue
		}
		out = append(out, gemOwnershipName{Name: name, SharePct: share})
	}
	return out
}

func upsertGEMEntity(ctx context.Context, tx pgx.Tx, name string, entityType string, releaseID uuid.UUID, raw map[string]any) (string, error) {
	name = normalizeName(stripGEMOwnershipPct(name))
	if name == "" {
		return "", nil
	}
	entityID := gemEntityID(name)
	_, err := tx.Exec(ctx, `
		INSERT INTO gem_entities (
			entity_id,
			name,
			normalized_name,
			entity_type,
			raw_payload,
			source_release_id
		)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (entity_id) DO UPDATE SET
			name = EXCLUDED.name,
			normalized_name = EXCLUDED.normalized_name,
			entity_type = COALESCE(NULLIF(gem_entities.entity_type, ''), EXCLUDED.entity_type),
			raw_payload = COALESCE(gem_entities.raw_payload, '{}'::jsonb) || EXCLUDED.raw_payload,
			source_release_id = EXCLUDED.source_release_id,
			updated_at = now()
	`, entityID, name, strings.ToLower(name), entityType, raw, releaseID)
	return entityID, err
}

func upsertGEMProductionFact(ctx context.Context, tx pgx.Tx, row map[string]string, releaseID uuid.UUID) (int, error) {
	unitID := gemCleanText(row["Unit ID"])
	if unitID == "" {
		return 0, nil
	}
	value, ok := gemParseNumber(row["Quantity (converted)"])
	if !ok {
		return 0, nil
	}
	year, _ := gemParseInt(row["Data Year"])
	assetID := uuid.Nil
	_ = tx.QueryRow(ctx, `
		SELECT id FROM assets
		WHERE legacy_table = 'gem_global_extraction_tracker' AND legacy_id = $1
		LIMIT 1
	`, unitID).Scan(&assetID)
	tag, err := tx.Exec(ctx, `
		INSERT INTO asset_production_facts (
			asset_id,
			gem_asset_id,
			product_code,
			year,
			production_value,
			unit,
			evidence_label,
			confidence_score,
			source_release_id,
			raw_payload
		)
		VALUES ($1,$2,$3,NULLIF($4,0),$5,$6,'reported',0.82,$7,$8)
		ON CONFLICT DO NOTHING
	`, nullableUUID(assetID), unitID, gemProductCode(row["Fuel description"]), year, value, gemCleanText(row["Units (converted)"]), releaseID, jsonMap(row))
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func upsertGEMReserveFact(ctx context.Context, tx pgx.Tx, row map[string]string, releaseID uuid.UUID) (int, error) {
	unitID := gemCleanText(row["Unit ID"])
	if unitID == "" {
		return 0, nil
	}
	value, ok := gemParseNumber(row["Quantity (converted)"])
	if !ok {
		return 0, nil
	}
	year, _ := gemParseInt(row["Data Year"])
	var asOf any
	if year > 0 {
		asOf = time.Date(year, 12, 31, 0, 0, 0, 0, time.UTC)
	}
	assetID := uuid.Nil
	_ = tx.QueryRow(ctx, `
		SELECT id FROM assets
		WHERE legacy_table = 'gem_global_extraction_tracker' AND legacy_id = $1
		LIMIT 1
	`, unitID).Scan(&assetID)
	tag, err := tx.Exec(ctx, `
		INSERT INTO asset_reserve_facts (
			asset_id,
			gem_asset_id,
			product_code,
			reserve_value,
			unit,
			as_of_date,
			evidence_label,
			confidence_score,
			source_release_id,
			raw_payload
		)
		VALUES ($1,$2,$3,$4,$5,$6,'reported',0.82,$7,$8)
		ON CONFLICT DO NOTHING
	`, nullableUUID(assetID), unitID, gemProductCode(row["Fuel description"]), value, gemCleanText(row["Units (converted)"]), asOf, releaseID, jsonMap(row))
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func gemEntityID(name string) string {
	n := strings.ToLower(normalizeName(name))
	n = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(n, "-")
	n = strings.Trim(n, "-")
	if n == "" {
		n = "unknown"
	}
	return "gem:name:" + n
}

func gemProductCode(raw string) string {
	switch strings.ToLower(gemCleanText(raw)) {
	case "oil", "liquids":
		return "CRUDEOIL"
	case "gas":
		return "GAS"
	case "ngl":
		return "NGL"
	case "condensate":
		return "CONDENSATE"
	default:
		v := strings.ToUpper(gemCleanText(raw))
		if v == "" {
			return "UNKNOWN"
		}
		return strings.ReplaceAll(v, " ", "_")
	}
}

func gemParseNumber(raw string) (float64, bool) {
	raw = strings.ReplaceAll(gemCleanText(raw), ",", "")
	if raw == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(raw, 64)
	return f, err == nil
}

func gemParseInt(raw string) (int, bool) {
	f, ok := gemParseNumber(raw)
	if !ok {
		return 0, false
	}
	return int(f), true
}

func jsonMap(row map[string]string) []byte {
	b, _ := json.Marshal(row)
	return b
}

func limitStringMaps(rows []map[string]string, max int) []map[string]string {
	if max <= 0 || len(rows) <= max {
		return rows
	}
	return rows[:max]
}
