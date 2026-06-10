package vessel

import (
	"context"
	"fmt"
	"strings"
	"time"

	sv "github.com/madsan/intelligence/internal/enrichment/vessel/shipvault"
)

// ShipVaultProvider enriches vessels via live ShipVault API (IMO required).
type ShipVaultProvider struct {
	Service *sv.Service
	StaleDays int
}

func (p *ShipVaultProvider) Name() string { return "shipvault" }

func (p *ShipVaultProvider) Enrich(ctx context.Context, mmsi, imo, name string) (Enrichment, error) {
	if p == nil || p.Service == nil {
		return Enrichment{}, ErrNotFound
	}
	imo = strings.TrimSpace(imo)
	if imo == "" {
		return Enrichment{}, fmt.Errorf("vessel %s has no IMO; ShipVault enrichment requires IMO", mmsi)
	}
	result, err := p.Service.FetchLive(ctx, imo)
	if err != nil {
		if strings.Contains(err.Error(), "404") {
			return Enrichment{}, ErrNotFound
		}
		return Enrichment{}, err
	}
	return FromShipVaultResult(mmsi, imo, result, p.StaleDays), nil
}

// FromShipVaultResult maps a live ShipVault payload into the madsan enrichment row shape.
func FromShipVaultResult(mmsi, imo string, result *sv.EnrichmentResult, staleDays int) Enrichment {
	if result == nil || result.Vessel == nil {
		return NotImplemented(mmsi, imo)
	}
	v := result.Vessel
	now := result.CachedAt.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	var buildYear *int
	if v.BuildYear > 0 {
		y := v.BuildYear
		buildYear = &y
	}
	var gt, dwt *float64
	if v.GrossTonnage > 0 {
		g := v.GrossTonnage
		gt = &g
	}
	if v.DeadweightTons > 0 {
		d := v.DeadweightTons
		dwt = &d
	}
	ownerName := strings.TrimSpace(v.OwnerName)
	if ownerName == "" && result.OwnerProfile != nil {
		ownerName = strings.TrimSpace(result.OwnerProfile.Name)
	}
	var fleet []any
	var ownerProfile map[string]any
	if result.OwnerProfile != nil {
		ownerProfile = map[string]any{
			"shipvault_company_id": result.OwnerProfile.ShipVaultCompanyID,
			"name":                 result.OwnerProfile.Name,
			"country":              result.OwnerProfile.Country,
			"fleet_size":           result.OwnerProfile.FleetSize,
		}
		for _, item := range result.OwnerProfile.Fleet {
			fleet = append(fleet, map[string]any{
				"imo":  item.IMO,
				"mmsi": item.MMSI,
				"name": item.Name,
				"type": item.Type,
			})
		}
	}
	raw := map[string]any{
		"shipvault_vessel_id": v.ShipVaultVesselID,
		"data_source":         result.DataSource,
		"enrichment_tier":     result.EnrichmentTier,
		"disclaimer":          result.Disclaimer,
	}
	if v.Raw != nil {
		raw["vessel"] = v.Raw
	}
	if result.OwnerProfile != nil && result.OwnerProfile.Raw != nil {
		raw["owner_company"] = result.OwnerProfile.Raw
	}
	return Enrichment{
		MMSI:           mmsi,
		IMO:            firstNonEmpty(imo, v.IMO),
		OwnerName:      ownerName,
		OperatorName:   strings.TrimSpace(v.OperatorName),
		OwnerCompanyID: v.OwnerCompanyID,
		Builder:        strings.TrimSpace(v.Builder),
		BuildYear:      buildYear,
		VesselClass:    strings.TrimSpace(v.VesselClass),
		Flag:           strings.TrimSpace(v.Flag),
		GrossTonnage:   gt,
		DeadweightTons: dwt,
		FleetList:      fleet,
		OwnerProfile:   ownerProfile,
		Source:         "shipvault",
		Tier:           "observed",
		Confidence:     78,
		FetchedAt:      now,
		StaleAfter:     StaleAfterFromTier("observed", staleDays, 7),
		RawPayload:     raw,
		Limitations: []string{
			"Registry data from ShipVault; indicative ownership — verify for compliance",
			result.Disclaimer,
		},
	}
}
