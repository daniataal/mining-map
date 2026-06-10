package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/confidence"
)

const (
	terminalEnrichmentBatch   = 100
	terminalEnrichmentTTL     = 90 * 24 * time.Hour
	terminalProximityMeters   = 5000
	legacyOilTerminalsTable   = "legacy_oil_terminals"
	terminalEnrichmentSource  = "terminal_enrichment"
)

type terminalEnrichmentRow struct {
	AssetID      uuid.UUID
	Name         string
	AssetType    string
	Country      string
	Latitude     float64
	Longitude    float64
	LegacyTable  string
	RawPayload   map[string]any
	Commodities  []string
}

type terminalEnrichmentResult struct {
	OperatorName string
	OwnerName    string
	CapacityVal  *float64
	CapacityUnit string
	Products     []byte
	OilTerminalID string
	Source       string
	Tier         string
	Confidence   float64
	Limitations  []string
	RawPayload   map[string]any
}

func (s *Service) processTerminalEnrichment(ctx context.Context, jobID uuid.UUID) error {
	started := time.Now()
	result, err := RunAssetEnrichmentBatch(ctx, s.pool, s.cfg, zerolog.Nop(), AssetEnrichBatchOptions{
		Limit: terminalEnrichmentBatch,
	})
	report := buildLegacyImportReport(map[string]any{
		"enriched":        result.Enriched,
		"skipped":         result.Skipped,
		"relationships":   result.Relationships,
		"evidence_claims": result.Evidence,
		"errors":          result.Errors,
	}, started)
	status := "completed"
	errMsg := ""
	if result.Enriched == 0 && err != nil {
		errMsg = err.Error()
	}
	_, execErr := s.pool.Exec(ctx, `
		UPDATE ingestion_jobs SET status=$2, result_report=$3, error_message=NULLIF($4,''), finished_at=now()
		WHERE id=$1
	`, jobID, status, report, errMsg)
	if execErr != nil && err == nil {
		return execErr
	}
	return err
}

func (s *Service) reconcileTerminalEnrichment(ctx context.Context, row terminalEnrichmentRow) (*terminalEnrichmentResult, error) {
	tags := osmTagsFromPayload(row.RawPayload)
	result := &terminalEnrichmentResult{
		Source: terminalEnrichmentSource,
		Tier:   "inferred",
		RawPayload: map[string]any{
			"asset_name": row.Name,
			"asset_type": row.AssetType,
		},
	}

	if row.LegacyTable == legacyOilTerminalsTable {
		return enrichFromCuratedTerminal(row, result), nil
	}

	if op, ok := tags["operator"].(string); ok && strings.TrimSpace(op) != "" {
		result.OperatorName = normalizeName(op)
		result.Source = "osm_tags"
		result.Tier = "observed"
		result.Confidence = 70
	}
	if ow, ok := tags["owner"].(string); ok && strings.TrimSpace(ow) != "" {
		result.OwnerName = normalizeName(ow)
	}
	if cap, unit := parseCapacityFromTags(tags); cap != nil {
		result.CapacityVal = cap
		result.CapacityUnit = unit
		if result.Tier != "observed" {
			result.Tier = "observed"
			result.Confidence = 65
		}
	}

	match, err := s.findNearbyCuratedTerminal(ctx, row.Latitude, row.Longitude, row.Name)
	if err != nil {
		return nil, err
	}
	if match != nil {
		applyCuratedMatch(result, match, row.Name)
	}

	if result.OperatorName == "" && result.CapacityVal == nil && result.OilTerminalID == "" {
		result.Limitations = append(result.Limitations, "No operator or capacity found in OSM tags or curated terminal match")
		return result, nil
	}
	if result.Confidence == 0 {
		if result.Tier == "observed" {
			result.Confidence = 60
		} else {
			result.Confidence = 45
		}
	}
	if match != nil && result.Tier == "inferred" {
		result.Limitations = append(result.Limitations, "Operator/capacity reconciled from nearby curated terminal within 5km")
	}
	return result, nil
}

func enrichFromCuratedTerminal(row terminalEnrichmentRow, result *terminalEnrichmentResult) *terminalEnrichmentResult {
	result.Source = legacyOilTerminalsTable
	result.Tier = "observed"
	result.Confidence = 75
	if op, ok := row.RawPayload["operator_name"].(string); ok {
		result.OperatorName = normalizeName(op)
	}
	if ow, ok := row.RawPayload["owner_name"].(string); ok {
		result.OwnerName = normalizeName(ow)
	}
	if products := legacyProductsFromPayload(row.RawPayload); len(products) > 0 {
		b, _ := json.Marshal(products)
		result.Products = b
	}
	if ext, ok := row.RawPayload["id"]; ok {
		result.OilTerminalID = fmt.Sprint(ext)
	}
	if cs, ok := toFloat(row.RawPayload["confidence_score"]); ok && cs > 0 {
		result.Confidence = cs
	}
	return result
}

type curatedTerminalMatch struct {
	LegacyID     string
	Name         string
	OperatorName string
	OwnerName    string
	Products     []string
	Confidence   float64
	DistanceM    float64
}

func (s *Service) findNearbyCuratedTerminal(ctx context.Context, lat, lng float64, assetName string) (*curatedTerminalMatch, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT a.legacy_id, a.name, a.raw_source_payload,
		       ST_Distance(a.geom, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography) AS dist_m
		FROM assets a
		WHERE a.legacy_table = $3
		  AND a.geom IS NOT NULL
		  AND ST_DWithin(a.geom, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, $4)
		ORDER BY dist_m
		LIMIT 10
	`, lat, lng, legacyOilTerminalsTable, terminalProximityMeters)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var best *curatedTerminalMatch
	for rows.Next() {
		var m curatedTerminalMatch
		var raw []byte
		if rows.Scan(&m.LegacyID, &m.Name, &raw, &m.DistanceM) != nil {
			continue
		}
		var payload map[string]any
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &payload)
		}
		if op, ok := payload["operator_name"].(string); ok {
			m.OperatorName = normalizeName(op)
		}
		if ow, ok := payload["owner_name"].(string); ok {
			m.OwnerName = normalizeName(ow)
		}
		m.Products = legacyProductsFromPayload(payload)
		if cs, ok := toFloat(payload["confidence_score"]); ok {
			m.Confidence = cs
		}
		if m.OperatorName == "" && m.OwnerName == "" && len(m.Products) == 0 {
			continue
		}
		score := m.DistanceM
		if namesSimilar(assetName, m.Name) {
			score -= 1000
		}
		if best == nil || score < best.DistanceM {
			cp := m
			cp.DistanceM = score
			best = &cp
		}
	}
	return best, nil
}

func applyCuratedMatch(result *terminalEnrichmentResult, match *curatedTerminalMatch, assetName string) {
	result.OilTerminalID = match.LegacyID
	result.RawPayload["matched_terminal_name"] = match.Name
	result.RawPayload["match_distance_m"] = match.DistanceM
	if result.OperatorName == "" && match.OperatorName != "" {
		result.OperatorName = match.OperatorName
		result.Source = legacyOilTerminalsTable
		if namesSimilar(assetName, match.Name) {
			result.Tier = "observed"
			result.Confidence = maxFloat(result.Confidence, 72)
		} else {
			result.Tier = "inferred"
			result.Confidence = maxFloat(result.Confidence, 55)
		}
	}
	if result.OwnerName == "" && match.OwnerName != "" {
		result.OwnerName = match.OwnerName
	}
	if len(result.Products) == 0 && len(match.Products) > 0 {
		b, _ := json.Marshal(match.Products)
		result.Products = b
	}
	if match.Confidence > result.Confidence {
		result.Confidence = match.Confidence
	}
}

func (s *Service) persistTerminalEnrichment(ctx context.Context, sourceID uuid.UUID, row terminalEnrichmentRow, result *terminalEnrichmentResult) (uuid.UUID, int, int, error) {
	staleAfter := time.Now().UTC().Add(terminalEnrichmentTTL)
	var companyID uuid.UUID
	relationships := 0
	evidenceRows := 0

	if result.OperatorName != "" {
		id, err := s.ensureCompanyByName(ctx, result.OperatorName, row.Country, row.Commodities)
		if err == nil && id != uuid.Nil {
			companyID = id
			_, _ = s.pool.Exec(ctx, `
				UPDATE assets SET operator_company_id = $2, updated_at = now()
				WHERE id = $1 AND operator_company_id IS NULL
			`, row.AssetID, companyID)
			if err := s.ensureRelationship(ctx, "asset", row.AssetID, "company", companyID, "operated_by", sourceID, result.Confidence); err == nil {
				relationships++
			}
		}
	}

	rawJSON, _ := json.Marshal(result.RawPayload)
	products := result.Products
	if len(products) == 0 {
		products = []byte("[]")
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO asset_enrichment (
			asset_id, operator_name, owner_name, operator_company_id,
			capacity_value, capacity_unit, products, oil_terminal_id,
			source, tier, confidence, fetched_at, stale_after, limitations, raw_payload
		) VALUES ($1,$2,$3,NULLIF($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid),$5,$6,$7,$8,$9,$10,$11,now(),$12,$13,$14)
		ON CONFLICT (asset_id) DO UPDATE SET
			operator_name = EXCLUDED.operator_name,
			owner_name = EXCLUDED.owner_name,
			operator_company_id = COALESCE(EXCLUDED.operator_company_id, asset_enrichment.operator_company_id),
			capacity_value = COALESCE(EXCLUDED.capacity_value, asset_enrichment.capacity_value),
			capacity_unit = COALESCE(EXCLUDED.capacity_unit, asset_enrichment.capacity_unit),
			products = CASE WHEN EXCLUDED.products != '[]'::jsonb THEN EXCLUDED.products ELSE asset_enrichment.products END,
			oil_terminal_id = COALESCE(EXCLUDED.oil_terminal_id, asset_enrichment.oil_terminal_id),
			source = EXCLUDED.source,
			tier = EXCLUDED.tier,
			confidence = GREATEST(asset_enrichment.confidence, EXCLUDED.confidence),
			fetched_at = now(),
			stale_after = EXCLUDED.stale_after,
			limitations = EXCLUDED.limitations,
			raw_payload = EXCLUDED.raw_payload,
			updated_at = now()
	`, row.AssetID, nullString(result.OperatorName), nullString(result.OwnerName), companyID,
		result.CapacityVal, nullString(result.CapacityUnit), products, nullString(result.OilTerminalID),
		result.Source, result.Tier, result.Confidence, staleAfter, result.Limitations, rawJSON)
	if err != nil {
		return companyID, relationships, evidenceRows, err
	}

	if sourceID != uuid.Nil {
		rec := NormalizedRecord{
			EntityType: "asset",
			Name:       row.Name,
			AssetType:  row.AssetType,
			CountryCode: row.Country,
			RawPayload: map[string]any{
				"operator_name": result.OperatorName,
				"owner_name":    result.OwnerName,
				"source":        result.Source,
				"tier":          result.Tier,
			},
		}
		if result.CapacityVal != nil {
			rec.RawPayload["capacity_value"] = *result.CapacityVal
			rec.RawPayload["capacity_unit"] = result.CapacityUnit
		}
		if result.OilTerminalID != "" {
			rec.RawPayload["oil_terminal_id"] = result.OilTerminalID
		}
		if err := s.attachEvidence(ctx, sourceID, "asset", row.AssetID, rec, result.Confidence); err == nil {
			evidenceRows = len(claimsForRecord(rec))
		}
	}
	return companyID, relationships, evidenceRows, nil
}

func osmTagsFromPayload(raw map[string]any) map[string]any {
	if raw == nil {
		return map[string]any{}
	}
	if tags, ok := raw["tags"].(map[string]any); ok {
		return tags
	}
	return map[string]any{}
}

func parseCapacityFromTags(tags map[string]any) (*float64, string) {
	for _, key := range []string{"capacity", "capacity:volumetric", "tank:capacity"} {
		if v, ok := tags[key]; ok {
			if f, ok := toFloat(v); ok {
				unit := "m3"
				if u, ok := tags["capacity:unit"].(string); ok && strings.TrimSpace(u) != "" {
					unit = strings.TrimSpace(u)
				}
				return &f, unit
			}
		}
	}
	return nil, ""
}

func legacyProductsFromPayload(raw map[string]any) []string {
	if raw == nil {
		return nil
	}
	switch p := raw["products"].(type) {
	case []string:
		return p
	case []any:
		return legacyStringArray(p)
	default:
		return nil
	}
}

func namesSimilar(a, b string) bool {
	a = strings.ToLower(strings.TrimSpace(a))
	b = strings.ToLower(strings.TrimSpace(b))
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	return strings.Contains(a, b) || strings.Contains(b, a)
}

func nullString(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func maxFloat(a, b float64) float64 {
	if b > a {
		return b
	}
	return a
}

// ReconcileTerminalFromTags is exported for unit tests.
func ReconcileTerminalFromTags(assetName string, tags map[string]any) terminalEnrichmentResult {
	result := terminalEnrichmentResult{Source: "osm_tags", Tier: "inferred"}
	if op, ok := tags["operator"].(string); ok && strings.TrimSpace(op) != "" {
		result.OperatorName = normalizeName(op)
		result.Tier = "observed"
		result.Confidence = confidence.Score(70, nil)
	}
	if cap, unit := parseCapacityFromTags(tags); cap != nil {
		result.CapacityVal = cap
		result.CapacityUnit = unit
		result.Tier = "observed"
	}
	_ = assetName
	return result
}
