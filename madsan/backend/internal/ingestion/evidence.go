package ingestion

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

type evidenceClaim struct {
	Type  string
	Value string
	Tier  string
}

func (s *Service) EnsureSource(ctx context.Context, slug string) (uuid.UUID, error) {
	return s.ensureSource(ctx, slug)
}

func (s *Service) AttachEvidence(ctx context.Context, sourceID uuid.UUID, entityType string, entityID uuid.UUID, rec NormalizedRecord, score float64) error {
	return s.attachEvidence(ctx, sourceID, entityType, entityID, rec, score)
}

func (s *Service) ensureSource(ctx context.Context, slug string) (uuid.UUID, error) {
	if slug == "" {
		slug = "unknown"
	}
	name, typ, category := sourceMeta(slug)
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO sources (source_name, slug, source_type, source_category, license, commercial_use_ok, reliability_score)
		VALUES ($1,$2,$3,$4,'open_data',true,60)
		ON CONFLICT (source_name) DO UPDATE SET slug = COALESCE(sources.slug, EXCLUDED.slug)
		RETURNING id
	`, name, slug, typ, category).Scan(&id)
	if err != nil {
		err = s.pool.QueryRow(ctx, `SELECT id FROM sources WHERE slug = $1 OR source_name = $1 LIMIT 1`, slug).Scan(&id)
	}
	return id, err
}

func sourceMeta(slug string) (name, typ, category string) {
	switch {
	case slug == "bunker_seed":
		return "Bunker fuel suppliers seed", "file", "government_register"
	case strings.HasPrefix(slug, "legacy_"):
		return strings.ReplaceAll(slug, "_", " "), "etl", "legacy_import"
	case slug == "legacy_oil_ais_positions":
		return "Legacy AIS positions", "api", "ais"
	case slug == "vessel_enrichment":
		return "Vessel owner/operator enrichment", "derived", "maritime_registry"
	default:
		return slug, "file", "import"
	}
}

func (s *Service) stageRecord(ctx context.Context, sourceID uuid.UUID, rec NormalizedRecord, rowNum int) error {
	raw, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	_, err = s.pool.Exec(ctx, `
		INSERT INTO staging_generic_records (source_id, entity_hint, row_number, raw_payload, record_hash)
		VALUES ($1,$2,$3,$4,$5)
	`, sourceID, rec.EntityType, rowNum, raw, hash)
	return err
}

func claimsForRecord(rec NormalizedRecord) []evidenceClaim {
	var claims []evidenceClaim
	if rec.Name != "" {
		claims = append(claims, evidenceClaim{Type: "name", Value: rec.Name, Tier: "observed"})
	}
	if rec.CountryCode != "" {
		claims = append(claims, evidenceClaim{Type: "country_code", Value: rec.CountryCode, Tier: "observed"})
	}
	if rec.Latitude != nil && rec.Longitude != nil {
		claims = append(claims, evidenceClaim{
			Type:  "coordinates",
			Value: fmt.Sprintf("%.5f,%.5f", *rec.Latitude, *rec.Longitude),
			Tier:  "observed",
		})
	}
	if rec.AssetType != "" {
		claims = append(claims, evidenceClaim{Type: "asset_type", Value: rec.AssetType, Tier: "observed"})
	}
	if len(rec.Commodities) > 0 {
		claims = append(claims, evidenceClaim{Type: "commodities", Value: strings.Join(rec.Commodities, ","), Tier: "observed"})
	}
	if rec.ExternalID != "" {
		claims = append(claims, evidenceClaim{Type: "external_id", Value: rec.ExternalID, Tier: "observed"})
	}
	if rec.RawPayload == nil {
		return claims
	}
	for _, key := range []string{"phone", "email", "source_url", "register_tier", "license_authority", "port_name", "hub_key", "imo", "vessel_type", "tanker_class"} {
		v, ok := rec.RawPayload[key]
		if !ok {
			continue
		}
		val := fmt.Sprint(v)
		if val == "" {
			continue
		}
		tier := "observed"
		if key == "register_tier" && val != "official_register" {
			tier = "inferred"
		}
		claims = append(claims, evidenceClaim{Type: key, Value: val, Tier: tier})
	}
	if mmsi := vesselMMSI(rec.RawPayload); mmsi != "" {
		claims = append(claims, evidenceClaim{Type: "mmsi", Value: mmsi, Tier: "observed"})
	}
	if ts, ok := rec.RawPayload["last_seen_at"].(string); ok && ts != "" {
		claims = append(claims, evidenceClaim{Type: "last_seen_at", Value: ts, Tier: "observed"})
	}
	return claims
}

func (s *Service) attachEvidence(ctx context.Context, sourceID uuid.UUID, entityType string, entityID uuid.UUID, rec NormalizedRecord, score float64) error {
	for _, c := range claimsForRecord(rec) {
		_, err := s.pool.Exec(ctx, `
			INSERT INTO evidence (source_id, entity_type, entity_id, claim_type, claim_value, confidence_score, tier)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
			ON CONFLICT (source_id, entity_type, entity_id, claim_type) DO UPDATE SET
				claim_value = EXCLUDED.claim_value,
				confidence_score = GREATEST(evidence.confidence_score, EXCLUDED.confidence_score),
				tier = EXCLUDED.tier
		`, sourceID, entityType, entityID, c.Type, c.Value, score, c.Tier)
		if err != nil {
			return err
		}
	}
	return nil
}
