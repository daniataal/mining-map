package shipvault

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// loadFromCache reads a cached EnrichmentResult from vessel_enrichment_cache.
// Stale rows are still returned so provider outages do not break already-known registry facts.
func loadFromCache(ctx context.Context, pool *pgxpool.Pool, imo string, ttl time.Duration) (*EnrichmentResult, error) {
	var (
		ownerName, ownerCompanyID, operatorName, builder, vesselClass, flag *string
		buildYear                                                           *int
		grossTonnage, deadweightTons, estimatedValueUSD                     *float64
		nameHistoryJSON, fleetListJSON, ownerProfileJSON, rawVesselJSON     []byte
		updatedAt                                                           time.Time
		shipvaultVesselID                                                   *string
		mmsi                                                                *int64
	)
	err := pool.QueryRow(ctx, `
		SELECT
			shipvault_vessel_id, mmsi,
			owner_name, owner_company_id, operator_name,
			builder, build_year, vessel_class, flag,
			gross_tonnage, deadweight_tons, estimated_value_usd,
			name_history, fleet_list, owner_profile, raw_vessel,
			updated_at
		FROM vessel_enrichment_cache
		WHERE imo = $1
	`, imo).Scan(
		&shipvaultVesselID, &mmsi,
		&ownerName, &ownerCompanyID, &operatorName,
		&builder, &buildYear, &vesselClass, &flag,
		&grossTonnage, &deadweightTons, &estimatedValueUSD,
		&nameHistoryJSON, &fleetListJSON, &ownerProfileJSON, &rawVesselJSON,
		&updatedAt,
	)
	if err != nil {
		// Row not found or scan error — caller will fetch from ShipVault.
		return nil, err
	}

	vessel := &VesselProfile{IMO: imo}
	if shipvaultVesselID != nil {
		vessel.ShipVaultVesselID = *shipvaultVesselID
	}
	if ownerName != nil {
		vessel.OwnerName = *ownerName
	}
	if ownerCompanyID != nil {
		vessel.OwnerCompanyID = *ownerCompanyID
	}
	if operatorName != nil {
		vessel.OperatorName = *operatorName
	}
	if builder != nil {
		vessel.Builder = *builder
	}
	if buildYear != nil {
		vessel.BuildYear = *buildYear
	}
	if vesselClass != nil {
		vessel.VesselClass = *vesselClass
	}
	if flag != nil {
		vessel.Flag = *flag
	}
	if grossTonnage != nil {
		vessel.GrossTonnage = *grossTonnage
	}
	if deadweightTons != nil {
		vessel.DeadweightTons = *deadweightTons
	}
	if estimatedValueUSD != nil {
		vessel.EstimatedValueUSD = *estimatedValueUSD
	}
	if len(nameHistoryJSON) > 0 {
		_ = json.Unmarshal(nameHistoryJSON, &vessel.NameHistory)
	}
	if len(rawVesselJSON) > 0 {
		_ = json.Unmarshal(rawVesselJSON, &vessel.Raw)
	}

	var ownerProfile *CompanyProfile
	if len(ownerProfileJSON) > 0 {
		ownerProfile = &CompanyProfile{}
		if err2 := json.Unmarshal(ownerProfileJSON, ownerProfile); err2 != nil {
			ownerProfile = nil
		}
		// Overlay fleet list.
		if ownerProfile != nil && len(fleetListJSON) > 0 {
			_ = json.Unmarshal(fleetListJSON, &ownerProfile.Fleet)
		}
	}

	stale := false
	if ttl > 0 {
		stale = time.Since(updatedAt) > ttl
	}
	return &EnrichmentResult{
		Vessel:         vessel,
		OwnerProfile:   ownerProfile,
		CachedAt:       updatedAt,
		DataSource:     "shipvault",
		EnrichmentTier: "registry",
		Disclaimer:     "Vessel registry data sourced from ShipVault. Values (e.g. estimated valuation) are indicative, not certified.",
		CacheStatus: CacheStatus{
			Hit:         true,
			Source:      "db_cache",
			Stale:       stale,
			WriteStatus: "not_attempted",
		},
	}, nil
}

// upsertCache writes or updates an EnrichmentResult in vessel_enrichment_cache.
func upsertCache(ctx context.Context, pool *pgxpool.Pool, mmsi int64, imo string, result *EnrichmentResult) error {
	v := result.Vessel

	var nameHistoryJSON, fleetListJSON, ownerProfileJSON, rawVesselJSON, rawCompanyJSON []byte
	var err error

	nameHistoryJSON, err = json.Marshal(v.NameHistory)
	if err != nil {
		nameHistoryJSON = []byte("[]")
	}
	rawVesselJSON, err = json.Marshal(v.Raw)
	if err != nil {
		rawVesselJSON = []byte("{}")
	}

	if result.OwnerProfile != nil {
		ownerProfileJSON, err = json.Marshal(result.OwnerProfile)
		if err != nil {
			ownerProfileJSON = []byte("{}")
		}
		fleetListJSON, err = json.Marshal(result.OwnerProfile.Fleet)
		if err != nil {
			fleetListJSON = []byte("[]")
		}
		rawCompanyJSON, err = json.Marshal(result.OwnerProfile.Raw)
		if err != nil {
			rawCompanyJSON = []byte("{}")
		}
	} else {
		ownerProfileJSON = []byte("{}")
		fleetListJSON = []byte("[]")
		rawCompanyJSON = []byte("{}")
	}

	var mmsiPtr *int64
	if mmsi != 0 {
		mmsiPtr = &mmsi
	}
	var shipvaultIDPtr *string
	if v.ShipVaultVesselID != "" {
		shipvaultIDPtr = &v.ShipVaultVesselID
	}
	var ownerCIDPtr *string
	if v.OwnerCompanyID != "" {
		ownerCIDPtr = &v.OwnerCompanyID
	}
	var ownerNamePtr, operatorNamePtr, builderPtr, vesselClassPtr, flagPtr *string
	setStrPtr := func(s string) *string {
		if s != "" {
			return &s
		}
		return nil
	}
	ownerNamePtr = setStrPtr(v.OwnerName)
	operatorNamePtr = setStrPtr(v.OperatorName)
	builderPtr = setStrPtr(v.Builder)
	vesselClassPtr = setStrPtr(v.VesselClass)
	flagPtr = setStrPtr(v.Flag)

	var buildYearPtr *int
	if v.BuildYear > 0 {
		buildYearPtr = &v.BuildYear
	}
	var grossTonnagePtr, deadweightTonsPtr, estimatedValuePtr *float64
	if v.GrossTonnage > 0 {
		grossTonnagePtr = &v.GrossTonnage
	}
	if v.DeadweightTons > 0 {
		deadweightTonsPtr = &v.DeadweightTons
	}
	if v.EstimatedValueUSD > 0 {
		estimatedValuePtr = &v.EstimatedValueUSD
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO vessel_enrichment_cache (
			imo, mmsi, shipvault_vessel_id,
			owner_name, owner_company_id, operator_name,
			builder, build_year, vessel_class, flag,
			gross_tonnage, deadweight_tons, estimated_value_usd,
			name_history, fleet_list, owner_profile,
			raw_vessel, raw_company,
			data_source, ingested_at, updated_at
		) VALUES (
			$1, $2, $3,
			$4, $5, $6,
			$7, $8, $9, $10,
			$11, $12, $13,
			$14, $15, $16,
			$17, $18,
			'shipvault', now(), now()
		)
		ON CONFLICT (imo) DO UPDATE SET
			mmsi                 = COALESCE($2,  vessel_enrichment_cache.mmsi),
			shipvault_vessel_id  = COALESCE($3,  vessel_enrichment_cache.shipvault_vessel_id),
			owner_name           = COALESCE($4,  vessel_enrichment_cache.owner_name),
			owner_company_id     = COALESCE($5,  vessel_enrichment_cache.owner_company_id),
			operator_name        = COALESCE($6,  vessel_enrichment_cache.operator_name),
			builder              = COALESCE($7,  vessel_enrichment_cache.builder),
			build_year           = COALESCE($8,  vessel_enrichment_cache.build_year),
			vessel_class         = COALESCE($9,  vessel_enrichment_cache.vessel_class),
			flag                 = COALESCE($10, vessel_enrichment_cache.flag),
			gross_tonnage        = COALESCE($11, vessel_enrichment_cache.gross_tonnage),
			deadweight_tons      = COALESCE($12, vessel_enrichment_cache.deadweight_tons),
			estimated_value_usd  = COALESCE($13, vessel_enrichment_cache.estimated_value_usd),
			name_history         = $14,
			fleet_list           = $15,
			owner_profile        = $16,
			raw_vessel           = $17,
			raw_company          = $18,
			updated_at           = now()
	`,
		imo, mmsiPtr, shipvaultIDPtr,
		ownerNamePtr, ownerCIDPtr, operatorNamePtr,
		builderPtr, buildYearPtr, vesselClassPtr, flagPtr,
		grossTonnagePtr, deadweightTonsPtr, estimatedValuePtr,
		nameHistoryJSON, fleetListJSON, ownerProfileJSON,
		rawVesselJSON, rawCompanyJSON,
	)
	if err != nil {
		return err
	}
	return upsertCoreVesselRegistry(ctx, pool, mmsi, imo, result)
}

func upsertCoreVesselRegistry(ctx context.Context, pool *pgxpool.Pool, mmsi int64, imo string, result *EnrichmentResult) error {
	if result == nil || result.Vessel == nil {
		return nil
	}
	v := result.Vessel
	ownerName := strings.TrimSpace(v.OwnerName)
	if ownerName == "" && result.OwnerProfile != nil {
		ownerName = strings.TrimSpace(result.OwnerProfile.Name)
	}
	ownerCountry := ""
	if result.OwnerProfile != nil {
		ownerCountry = strings.TrimSpace(result.OwnerProfile.Country)
	}
	operatorName := strings.TrimSpace(v.OperatorName)

	var ownerID, operatorID string
	var err error
	if ownerName != "" {
		ownerID, err = upsertCoreOrganization(ctx, pool, ownerName, ownerCountry, map[string]any{
			"source":               "shipvault",
			"shipvault_company_id": v.OwnerCompanyID,
			"fleet_size":           ownerFleetSize(result.OwnerProfile),
		})
		if err != nil {
			return err
		}
	}
	if operatorName != "" && !strings.EqualFold(operatorName, ownerName) {
		operatorID, err = upsertCoreOrganization(ctx, pool, operatorName, "", map[string]any{
			"source": "shipvault",
			"role":   "operator",
		})
		if err != nil {
			return err
		}
	}

	assetID, err := upsertCoreVesselAsset(ctx, pool, mmsi, imo, v)
	if err != nil {
		return err
	}
	if assetID != "" && ownerID != "" {
		if err := upsertCoreAssetRelationship(ctx, pool, assetID, ownerID, "owner", "ShipVault registered owner"); err != nil {
			return err
		}
	}
	if assetID != "" && operatorID != "" {
		if err := upsertCoreAssetRelationship(ctx, pool, assetID, operatorID, "operator", "ShipVault operator/commercial manager"); err != nil {
			return err
		}
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO core_vessel_registry_links (
			imo, mmsi, vessel_name, owner_organization_id, operator_organization_id,
			source_key, vessel_enrichment_cached_at, metadata, updated_at
		) VALUES ($1,$2,$3,$4,$5,'shipvault',now(),$6,now())
		ON CONFLICT (imo) DO UPDATE SET
			mmsi = COALESCE(EXCLUDED.mmsi, core_vessel_registry_links.mmsi),
			vessel_name = COALESCE(NULLIF(EXCLUDED.vessel_name, ''), core_vessel_registry_links.vessel_name),
			owner_organization_id = COALESCE(EXCLUDED.owner_organization_id, core_vessel_registry_links.owner_organization_id),
			operator_organization_id = COALESCE(EXCLUDED.operator_organization_id, core_vessel_registry_links.operator_organization_id),
			source_key = 'shipvault',
			vessel_enrichment_cached_at = now(),
			metadata = core_vessel_registry_links.metadata || EXCLUDED.metadata,
			updated_at = now()
	`, imo, nullInt64(mmsi), strings.TrimSpace(v.Name), nullString(ownerID), nullString(operatorID), map[string]any{
		"shipvault_vessel_id": v.ShipVaultVesselID,
		"owner_company_id":    v.OwnerCompanyID,
		"cache_status":        result.CacheStatus,
	})
	return err
}

func upsertCoreOrganization(ctx context.Context, pool *pgxpool.Pool, name, country string, metadata map[string]any) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", nil
	}
	normalized := normalizeCoreName(name)
	if normalized == "" {
		return "", nil
	}
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO core_organizations (name, normalized_name, country, source_key, confidence, metadata)
		VALUES ($1,$2,NULLIF($3,''),'shipvault',0.72,$4)
		ON CONFLICT (normalized_name, country) DO UPDATE SET
			name = COALESCE(NULLIF(core_organizations.name, ''), EXCLUDED.name),
			source_key = COALESCE(core_organizations.source_key, EXCLUDED.source_key),
			metadata = core_organizations.metadata || EXCLUDED.metadata,
			updated_at = now()
		RETURNING id::text
	`, name, normalized, strings.TrimSpace(country), metadata).Scan(&id)
	return id, err
}

func upsertCoreVesselAsset(ctx context.Context, pool *pgxpool.Pool, mmsi int64, imo string, v *VesselProfile) (string, error) {
	if v == nil {
		return "", nil
	}
	name := strings.TrimSpace(v.Name)
	if name == "" {
		name = "IMO " + strings.TrimSpace(imo)
	}
	legacyID := strings.TrimSpace(imo)
	if mmsi != 0 {
		legacyID = fmt.Sprintf("%d", mmsi)
	}
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO core_assets (
			asset_type, name, normalized_name, country, commodity_family,
			source_key, legacy_table, legacy_id, confidence, metadata
		) VALUES (
			'vessel',$1,$2,NULLIF($3,''),'oil_gas',
			'shipvault','oil_vessels',$4,0.72,$5
		)
		ON CONFLICT (legacy_table, legacy_id)
		WHERE legacy_table IS NOT NULL AND legacy_id IS NOT NULL
		DO UPDATE SET
			name = COALESCE(NULLIF(EXCLUDED.name, ''), core_assets.name),
			normalized_name = COALESCE(NULLIF(EXCLUDED.normalized_name, ''), core_assets.normalized_name),
			country = COALESCE(EXCLUDED.country, core_assets.country),
			source_key = 'shipvault',
			metadata = core_assets.metadata || EXCLUDED.metadata,
			updated_at = now()
		RETURNING id::text
	`, name, normalizeCoreName(name), strings.TrimSpace(v.Flag), legacyID, map[string]any{
		"imo":                 strings.TrimSpace(imo),
		"mmsi":                mmsi,
		"shipvault_vessel_id": v.ShipVaultVesselID,
		"vessel_class":        v.VesselClass,
		"builder":             v.Builder,
		"build_year":          v.BuildYear,
		"gross_tonnage":       v.GrossTonnage,
		"deadweight_tons":     v.DeadweightTons,
	}).Scan(&id)
	return id, err
}

func upsertCoreAssetRelationship(ctx context.Context, pool *pgxpool.Pool, assetID, orgID, role, label string) error {
	if assetID == "" || orgID == "" || role == "" {
		return nil
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO core_asset_relationships (
			asset_id, organization_id, relationship_role, relationship_label,
			source_key, source_url, confidence, verification_status, metadata
		) VALUES ($1,$2,$3,$4,'shipvault','https://www.shipvault.com/',0.72,'source_backed',$5)
		ON CONFLICT (
			asset_id, organization_id, relationship_role,
			(COALESCE(source_key, '')), (COALESCE(source_record_id::text, ''))
		) DO UPDATE SET
			relationship_label = EXCLUDED.relationship_label,
			confidence = GREATEST(core_asset_relationships.confidence, EXCLUDED.confidence),
			verification_status = EXCLUDED.verification_status,
			metadata = core_asset_relationships.metadata || EXCLUDED.metadata,
			updated_at = now()
	`, assetID, orgID, role, label, map[string]any{"source": "shipvault"})
	return err
}

func normalizeCoreName(name string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(name))), " ")
}

func ownerFleetSize(c *CompanyProfile) int {
	if c == nil {
		return 0
	}
	if c.FleetSize > 0 {
		return c.FleetSize
	}
	return len(c.Fleet)
}

func nullString(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}

func nullInt64(v int64) *int64 {
	if v == 0 {
		return nil
	}
	return &v
}
