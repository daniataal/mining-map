package ingestion

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func (s *Service) assetIDByLegacyLicenseRef(ctx context.Context, licenseRef string) uuid.UUID {
	if licenseRef == "" {
		return uuid.Nil
	}
	var id uuid.UUID
	_ = s.pool.QueryRow(ctx, `
		SELECT id FROM assets
		WHERE legacy_table = 'legacy_licenses' AND legacy_id = $1
		LIMIT 1
	`, licenseRef).Scan(&id)
	return id
}

func (s *Service) assetIDByLegacyTerminal(ctx context.Context, legacy *pgxpool.Pool, legacyTerminalID uuid.UUID) uuid.UUID {
	if legacyTerminalID == uuid.Nil {
		return uuid.Nil
	}
	var id uuid.UUID
	_ = s.pool.QueryRow(ctx, `
		SELECT id FROM assets
		WHERE legacy_table = 'legacy_oil_terminals' AND legacy_id = $1
		LIMIT 1
	`, legacyTerminalID.String()).Scan(&id)
	if id != uuid.Nil {
		return id
	}
	var name, country string
	if err := legacy.QueryRow(ctx, `SELECT name, country FROM oil_terminals WHERE id = $1`, legacyTerminalID).Scan(&name, &country); err != nil {
		return uuid.Nil
	}
	name = normalizeName(name)
	if name == "" {
		return uuid.Nil
	}
	_ = s.pool.QueryRow(ctx, `
		SELECT id FROM assets
		WHERE normalized_name = lower($1)
		  AND asset_type IN ('terminal', 'tank_farm', 'port', 'refinery')
		  AND COALESCE(country_code, '') = COALESCE(upper(NULLIF($2,'')), '')
		LIMIT 1
	`, name, country).Scan(&id)
	return id
}

func (s *Service) companyIDByName(ctx context.Context, name, country string) uuid.UUID {
	name = normalizeName(name)
	if name == "" {
		return uuid.Nil
	}
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT id FROM companies
		WHERE normalized_name = lower($1)
		ORDER BY CASE WHEN COALESCE(country_code,'') = COALESCE(upper(NULLIF($2,'')), '') THEN 0 ELSE 1 END,
		         confidence_score DESC NULLS LAST
		LIMIT 1
	`, name, country).Scan(&id)
	if err == nil {
		return id
	}
	id, err = s.ensureCompanyByName(ctx, name, country, nil)
	if err != nil {
		return uuid.Nil
	}
	return id
}

func (s *Service) resolveIntelCardEntity(ctx context.Context, legacy *pgxpool.Pool, row map[string]any) (string, uuid.UUID) {
	if mmsi := legacyMMSIStr(row["mmsi"]); mmsi != "" {
		if id := s.vesselIDByMMSI(ctx, mmsi); id != uuid.Nil {
			return "vessel", id
		}
	}
	if cid := parseUUID(row["company_id"]); cid != uuid.Nil {
		if id := s.companyIDByLegacyOilCompany(ctx, legacy, cid); id != uuid.Nil {
			return "company", id
		}
	}
	if tid := parseUUID(row["terminal_id"]); tid != uuid.Nil {
		if id := s.assetIDByLegacyTerminal(ctx, legacy, tid); id != uuid.Nil {
			return "asset", id
		}
	}
	return "", uuid.Nil
}

func mapLegacyRelationshipType(relType string) string {
	switch relType {
	case "operator":
		return "operated_by"
	case "owner":
		return "owned_by"
	default:
		return relType
	}
}

func legacyRelationshipScore(conf float64) float64 {
	if conf <= 1 {
		conf *= 100
	}
	if conf <= 0 {
		return 60
	}
	return conf
}

func gemPipelineOSMKey(segmentKey string) string {
	return fmt.Sprintf("gem:%s", segmentKey)
}
