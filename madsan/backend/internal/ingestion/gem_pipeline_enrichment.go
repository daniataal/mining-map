package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	gemPipelineEnrichmentSource = "gem_goit_pipelines"
	gemPipelineEnrichmentTier = "observed"
)

var gemOwnershipPctRE = regexp.MustCompile(`\s*\[[^\]]*\]\s*`)

type gemPipelineCommercial struct {
	OwnerName      string
	ParentName     string
	OperatorName   string
	Status         string
	Fuel           string
	FuelGroup      string
	CapacityValue  *float64
	CapacityUnit   string
	CapacityText   string
	LengthKm       *float64
	Diameter       string
	DiameterUnits  string
	WikiURL        string
	OwnerEntityIDs string
	SegmentKey     string
	ProjectID      string
	Countries      string
	StartLocation  string
	EndLocation    string
	SourceName     string
	SourceURL      string
}

func stripGEMOwnershipPct(s string) string {
	s = gemOwnershipPctRE.ReplaceAllString(s, " ")
	return strings.TrimSpace(strings.Trim(s, ";,"))
}

func isGEMUnknownCommercialName(s string) bool {
	n := strings.ToLower(strings.TrimSpace(stripGEMOwnershipPct(s)))
	return n == "" || n == "unknown"
}

func gemFieldString(raw map[string]any, tags map[string]any, keys ...string) string {
	for _, key := range keys {
		if tags != nil {
			if v := gemCleanText(tags[strings.ToLower(key)]); v != "" {
				return v
			}
			if v := gemCleanText(tags[key]); v != "" {
				return v
			}
		}
		if raw != nil {
			if v := gemCleanText(raw[key]); v != "" {
				return v
			}
		}
	}
	return ""
}

func parseGEMPipelineCommercial(raw map[string]any, tags map[string]any) gemPipelineCommercial {
	if raw == nil && tags == nil {
		return gemPipelineCommercial{}
	}
	ownerRaw := gemFieldString(raw, tags, "Owner", "owner")
	parentRaw := gemFieldString(raw, tags, "Parent", "parent")
	out := gemPipelineCommercial{
		OwnerName:      normalizeName(stripGEMOwnershipPct(ownerRaw)),
		ParentName:     normalizeName(stripGEMOwnershipPct(parentRaw)),
		Status:         strings.ToLower(gemFieldString(raw, tags, "Status", "status")),
		Fuel:           gemFieldString(raw, tags, "Fuel", "fuel"),
		FuelGroup:      strings.ToLower(gemFieldString(raw, tags, "fuel_group", "FuelGroup")),
		CapacityText:   gemFieldString(raw, tags, "capacity_text"),
		Diameter:       gemFieldString(raw, tags, "Diameter", "diameter"),
		DiameterUnits:  gemFieldString(raw, tags, "DiameterUnits", "diameter_units"),
		WikiURL:        gemFieldString(raw, tags, "Wiki", "wiki"),
		OwnerEntityIDs: gemFieldString(raw, tags, "OwnerEntityIDs", "owner_entity_ids"),
		SegmentKey:     gemFieldString(raw, tags, "segment_key", "SegmentKey"),
		ProjectID:      gemFieldString(raw, tags, "ProjectID", "project_id"),
		Countries:      gemFieldString(raw, tags, "Countries", "countries"),
		StartLocation:  gemFieldString(raw, tags, "StartLocation", "start_location"),
		EndLocation:    gemFieldString(raw, tags, "EndLocation", "end_location"),
		SourceName:     gemFieldString(raw, tags, "source_name"),
		SourceURL:      gemFieldString(raw, tags, "source_url"),
	}
	if v, ok := gemParseCoord(gemFieldString(raw, tags, "capacity_boed", "CapacityBOEd")); ok {
		out.CapacityValue = &v
		out.CapacityUnit = "boed"
	}
	if out.CapacityText == "" {
		cap := gemFieldString(raw, tags, "Capacity")
		units := gemFieldString(raw, tags, "CapacityUnits")
		if cap != "" && units != "" {
			out.CapacityText = cap + " " + units
		} else {
			out.CapacityText = cap
		}
	}
	for _, key := range []string{"LengthMergedKm", "LengthKnownKm", "LengthEstimateKm", "length_km"} {
		if v, ok := gemParseCoord(gemFieldString(raw, tags, key)); ok {
			out.LengthKm = &v
			break
		}
	}
	if op := gemCleanText(raw["operator_name"]); op != "" && out.OwnerName == "" {
		out.OwnerName = normalizeName(op)
	}
	if out.OwnerName != "" {
		out.OperatorName = out.OwnerName
	}
	return out
}

func (s *Service) linkAssetOwner(ctx context.Context, assetID uuid.UUID, ownerName, country string, commodities []string, sourceID uuid.UUID, score float64) error {
	ownerName = normalizeName(ownerName)
	if ownerName == "" || assetID == uuid.Nil {
		return nil
	}
	companyID, err := s.ensureCompanyByName(ctx, ownerName, country, commodities)
	if err != nil || companyID == uuid.Nil {
		return err
	}
	_, _ = s.pool.Exec(ctx, `
		UPDATE assets SET owner_company_id = $2, updated_at = now()
		WHERE id = $1 AND owner_company_id IS NULL
	`, assetID, companyID)
	return s.ensureRelationship(ctx, "asset", assetID, "company", companyID, "owned_by", sourceID, score)
}

func (s *Service) upsertGEMPipelineEnrichment(ctx context.Context, assetID uuid.UUID, rec NormalizedRecord, tags map[string]any, sourceID uuid.UUID) error {
	if assetID == uuid.Nil || rec.AssetType != "pipeline" {
		return nil
	}
	commercial := parseGEMPipelineCommercial(rec.RawPayload, tags)
	if len(BuildGEMPipelineProfile(rec.RawPayload, tags)) == 0 {
		return nil
	}

	score := 75.0
	relationships := 0
	if commercial.OwnerName != "" {
		if err := s.linkAssetOwner(ctx, assetID, commercial.OwnerName, rec.CountryCode, rec.Commodities, sourceID, score); err == nil {
			relationships++
		}
	}
	if commercial.ParentName != "" && commercial.ParentName != commercial.OwnerName && !isGEMUnknownCommercialName(commercial.ParentName) {
		parentID, _ := s.ensureCompanyByName(ctx, commercial.ParentName, rec.CountryCode, rec.Commodities)
		if parentID != uuid.Nil {
			if err := s.ensureRelationship(ctx, "asset", assetID, "company", parentID, "parent_company", sourceID, score-10); err == nil {
				relationships++
			}
		}
	}

	var companyID uuid.UUID
	if commercial.OwnerName != "" {
		companyID, _ = s.ensureCompanyByName(ctx, commercial.OwnerName, rec.CountryCode, rec.Commodities)
	}

	rawPayload := map[string]any{"commercial": commercial, "tags": tags}
	if rec.RawPayload != nil {
		for k, v := range rec.RawPayload {
			rawPayload[k] = v
		}
	}
	rawJSON, _ := json.Marshal(rawPayload)
	products := []byte("[]")
	if commercial.Fuel != "" {
		products, _ = json.Marshal([]string{commercial.Fuel})
	}
	limitations := []string{
		"GEM GOIT commercial attributes (CC BY 4.0) — no direct contact channels in this dataset.",
	}
	staleAfter := time.Now().UTC().Add(365 * 24 * time.Hour)

	_, err := s.pool.Exec(ctx, `
		INSERT INTO asset_enrichment (
			asset_id, operator_name, owner_name, operator_company_id,
			capacity_value, capacity_unit, products,
			source, tier, confidence, fetched_at, stale_after, limitations, raw_payload
		) VALUES ($1,$2,$3,NULLIF($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid),$5,$6,$7,$8,$9,$10,now(),$11,$12,$13)
		ON CONFLICT (asset_id) DO UPDATE SET
			operator_name = COALESCE(NULLIF(EXCLUDED.operator_name,''), asset_enrichment.operator_name),
			owner_name = COALESCE(NULLIF(EXCLUDED.owner_name,''), asset_enrichment.owner_name),
			operator_company_id = COALESCE(EXCLUDED.operator_company_id, asset_enrichment.operator_company_id),
			capacity_value = COALESCE(EXCLUDED.capacity_value, asset_enrichment.capacity_value),
			capacity_unit = COALESCE(EXCLUDED.capacity_unit, asset_enrichment.capacity_unit),
			products = CASE WHEN EXCLUDED.products != '[]'::jsonb THEN EXCLUDED.products ELSE asset_enrichment.products END,
			source = EXCLUDED.source,
			tier = EXCLUDED.tier,
			confidence = GREATEST(asset_enrichment.confidence, EXCLUDED.confidence),
			fetched_at = now(),
			stale_after = EXCLUDED.stale_after,
			limitations = EXCLUDED.limitations,
			raw_payload = EXCLUDED.raw_payload,
			updated_at = now()
	`, assetID, nullString(commercial.OperatorName), nullString(commercial.OwnerName), companyID,
		commercial.CapacityValue, nullString(commercial.CapacityUnit), products,
		gemPipelineEnrichmentSource, gemPipelineEnrichmentTier, score, staleAfter, limitations, rawJSON)
	if err != nil {
		return fmt.Errorf("upsert gem pipeline enrichment: %w", err)
	}
	_ = relationships
	return nil
}

func (s *Service) BackfillGEMPipelineEnrichment(ctx context.Context, limit int) (int, error) {
	if limit <= 0 {
		limit = 50000
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, COALESCE(country_code,''), commodities_supported, raw_source_payload
		FROM assets
		WHERE legacy_table = $1
		ORDER BY updated_at DESC NULLS LAST
		LIMIT $2
	`, gemPipelineEnrichmentSource, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	sourceID, _ := s.ensureSource(ctx, gemPipelineSourceSlug)
	written := 0
	for rows.Next() {
		var assetID uuid.UUID
		var name, country string
		var commodities []string
		var raw []byte
		if rows.Scan(&assetID, &name, &country, &commodities, &raw) != nil {
			continue
		}
		rec := NormalizedRecord{
			EntityType: "asset", AssetType: "pipeline", Name: name,
			CountryCode: country, Commodities: commodities,
			RawPayload: map[string]any{},
		}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &rec.RawPayload)
		}
		var tags map[string]any
		if t, ok := rec.RawPayload["tags"].(map[string]any); ok {
			tags = t
		}
		if err := s.upsertGEMPipelineEnrichment(ctx, assetID, rec, tags, sourceID); err == nil {
			written++
		}
	}
	return written, rows.Err()
}
