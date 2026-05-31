package shipvault

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// loadFromCache reads a cached EnrichmentResult from vessel_enrichment_cache.
// Returns nil (not an error) when the row is missing or has exceeded the TTL.
func loadFromCache(ctx context.Context, pool *pgxpool.Pool, imo string) (*EnrichmentResult, error) {
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

	return &EnrichmentResult{
		Vessel:         vessel,
		OwnerProfile:   ownerProfile,
		CachedAt:       updatedAt,
		DataSource:     "shipvault",
		EnrichmentTier: "registry",
		Disclaimer:     "Vessel registry data sourced from ShipVault. Values (e.g. estimated valuation) are indicative, not certified.",
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
	return err
}
