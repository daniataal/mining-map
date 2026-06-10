package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/confidence"
)

func operatorNameFromRecord(rec NormalizedRecord) string {
	if rec.RawPayload == nil {
		return ""
	}
	if tags, ok := rec.RawPayload["tags"].(map[string]any); ok {
		if op, ok := tags["operator"].(string); ok && strings.TrimSpace(op) != "" {
			return normalizeName(op)
		}
	}
	for _, key := range []string{"company", "operator", "operator_company", "operator_name"} {
		if v, ok := rec.RawPayload[key].(string); ok && strings.TrimSpace(v) != "" {
			return normalizeName(v)
		}
	}
	return ""
}

func (s *Service) linkAssetOperator(ctx context.Context, assetID uuid.UUID, rec NormalizedRecord, sourceID uuid.UUID) error {
	if rec.EntityType != "asset" || assetID == uuid.Nil {
		return nil
	}
	opName := operatorNameFromRecord(rec)
	if opName == "" {
		return nil
	}
	companyID, err := s.ensureCompanyByName(ctx, opName, rec.CountryCode, rec.Commodities)
	if err != nil || companyID == uuid.Nil {
		return err
	}
	_, _ = s.pool.Exec(ctx, `
		UPDATE assets SET operator_company_id = $2, updated_at = now()
		WHERE id = $1 AND operator_company_id IS NULL
	`, assetID, companyID)
	return s.ensureRelationship(ctx, "asset", assetID, "company", companyID, "operated_by", sourceID, 60)
}

func (s *Service) ensureCompanyByName(ctx context.Context, name, country string, commodities []string) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT id FROM companies
		WHERE normalized_name = lower($1)
		ORDER BY confidence_score DESC NULLS LAST
		LIMIT 1
	`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	score := confidence.Score(45, map[string]bool{})
	status := confidence.Status(score)
	err = s.pool.QueryRow(ctx, `
		INSERT INTO companies (name, normalized_name, country_code, company_type, commodities, confidence_score, data_quality_status)
		VALUES ($1, lower($1), NULLIF($2,''), 'operator', $3, $4, $5)
		RETURNING id
	`, name, country, commodities, score, status).Scan(&id)
	return id, err
}

func (s *Service) ensureRelationship(ctx context.Context, fromType string, fromID uuid.UUID, toType string, toID uuid.UUID, relType string, sourceID uuid.UUID, score float64) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO relationships (from_entity_type, from_entity_id, to_entity_type, to_entity_id, relationship_type, source_id, confidence_score)
		SELECT $1,$2,$3,$4,$5,$6,$7
		WHERE NOT EXISTS (
			SELECT 1 FROM relationships
			WHERE from_entity_type = $1 AND from_entity_id = $2
			  AND to_entity_type = $3 AND to_entity_id = $4
			  AND relationship_type = $5
		)
	`, fromType, fromID, toType, toID, relType, nullableUUID(sourceID), score)
	return err
}

func nullableUUID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

// BackfillRelationships links assets to companies from OSM operator tags, license company fields, and name matches.
func BackfillRelationships(ctx context.Context, pool *pgxpool.Pool, limit int) (linked, relationships int, err error) {
	if limit <= 0 {
		limit = 10000
	}
	svc := &Service{pool: pool}
	rows, err := pool.Query(ctx, `
		SELECT id, name, COALESCE(country_code,''), commodities_supported, raw_source_payload
		FROM assets
		WHERE operator_company_id IS NULL
		  AND (
		    raw_source_payload->'tags'->>'operator' IS NOT NULL
		    OR raw_source_payload->>'company' IS NOT NULL
		  )
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var assetID uuid.UUID
		var name, country string
		var commodities []string
		var raw []byte
		if rows.Scan(&assetID, &name, &country, &commodities, &raw) != nil {
			continue
		}
		rec := NormalizedRecord{
			EntityType: "asset", Name: name, CountryCode: country, Commodities: commodities,
		}
		if len(raw) > 0 {
			_ = jsonUnmarshal(raw, &rec.RawPayload)
		}
		if err := svc.linkAssetOperator(ctx, assetID, rec, uuid.Nil); err == nil {
			linked++
			relationships++
		}
	}

	nameRows, err := pool.Query(ctx, `
		SELECT a.id, a.name, COALESCE(a.country_code,''), c.id
		FROM assets a
		JOIN companies c ON c.normalized_name = a.normalized_name
		WHERE a.operator_company_id IS NULL
		  AND a.asset_type IN ('mine', 'terminal', 'tank_farm', 'refinery', 'port')
		LIMIT $1
	`, limit)
	if err != nil {
		return linked, relationships, err
	}
	defer nameRows.Close()
	for nameRows.Next() {
		var assetID, companyID uuid.UUID
		var name, country string
		if nameRows.Scan(&assetID, &name, &country, &companyID) != nil {
			continue
		}
		_, _ = pool.Exec(ctx, `UPDATE assets SET operator_company_id = $2 WHERE id = $1`, assetID, companyID)
		if err := svc.ensureRelationship(ctx, "asset", assetID, "company", companyID, "operated_by", uuid.Nil, 55); err == nil {
			linked++
			relationships++
		}
	}
	return linked, relationships, nil
}

func jsonUnmarshal(b []byte, v *map[string]any) error {
	if v == nil {
		return fmt.Errorf("nil map")
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	*v = m
	return nil
}
