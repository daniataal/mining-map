package vessel

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// LegacyCacheProvider reads rows from mining_db.vessel_enrichment_cache (ShipVault legacy cache).
type LegacyCacheProvider struct {
	Pool *pgxpool.Pool
}

func (p *LegacyCacheProvider) Name() string { return "legacy_shipvault_cache" }

func (p *LegacyCacheProvider) Enrich(ctx context.Context, mmsi, imo, name string) (Enrichment, error) {
	if p == nil || p.Pool == nil {
		return Enrichment{}, ErrNotFound
	}
	row, err := p.loadRow(ctx, mmsi, imo)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Enrichment{}, ErrNotFound
		}
		return Enrichment{}, err
	}
	now := time.Now().UTC()
	raw := map[string]any{"legacy_cache": true}
	if len(row.rawVessel) > 0 {
		var m map[string]any
		if json.Unmarshal(row.rawVessel, &m) == nil {
			raw["raw_vessel"] = m
		}
	}
	var fleet []any
	if len(row.fleetList) > 0 {
		_ = json.Unmarshal(row.fleetList, &fleet)
	}
	var ownerProfile map[string]any
	if len(row.ownerProfile) > 0 {
		_ = json.Unmarshal(row.ownerProfile, &ownerProfile)
	}
	conf := 72.0
	if row.ownerName == "" && row.operatorName == "" {
		return Enrichment{}, ErrNotFound
	}
	return Enrichment{
		MMSI:           mmsi,
		IMO:            firstNonEmpty(imo, row.imo),
		OwnerName:      row.ownerName,
		OperatorName:   row.operatorName,
		OwnerCompanyID: row.ownerCompanyID,
		Builder:        row.builder,
		BuildYear:      row.buildYear,
		VesselClass:    row.vesselClass,
		Flag:           row.flag,
		GrossTonnage:   row.grossTonnage,
		DeadweightTons: row.deadweightTons,
		FleetList:      fleet,
		OwnerProfile:   ownerProfile,
		Source:         "legacy_shipvault_cache",
		Tier:           "observed",
		Confidence:     conf,
		FetchedAt:      now,
		StaleAfter:     StaleAfterFromTier("observed", 120, 7),
		RawPayload:     raw,
		Limitations:    []string{"Sourced from legacy ShipVault cache; indicative registry data"},
	}, nil
}

type legacyCacheRow struct {
	imo, ownerName, ownerCompanyID, operatorName, builder, vesselClass, flag string
	buildYear                                                                *int
	grossTonnage, deadweightTons                                             *float64
	fleetList, ownerProfile, rawVessel                                       []byte
}

func (p *LegacyCacheProvider) loadRow(ctx context.Context, mmsi, imo string) (legacyCacheRow, error) {
	var row legacyCacheRow
	q := `
		SELECT imo, owner_name, COALESCE(owner_company_id,''), operator_name,
		       COALESCE(builder,''), build_year, COALESCE(vessel_class,''), COALESCE(flag,''),
		       gross_tonnage, deadweight_tons, fleet_list, owner_profile, raw_vessel
		FROM vessel_enrichment_cache
		WHERE `
	var args []any
	switch {
	case imo != "":
		q += "imo = $1"
		args = append(args, imo)
	case mmsi != "":
		q += "mmsi::text = $1"
		args = append(args, mmsi)
	default:
		return row, pgx.ErrNoRows
	}
	q += " ORDER BY updated_at DESC LIMIT 1"
	err := p.Pool.QueryRow(ctx, q, args...).Scan(
		&row.imo, &row.ownerName, &row.ownerCompanyID, &row.operatorName,
		&row.builder, &row.buildYear, &row.vesselClass, &row.flag,
		&row.grossTonnage, &row.deadweightTons, &row.fleetList, &row.ownerProfile, &row.rawVessel,
	)
	return row, err
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
