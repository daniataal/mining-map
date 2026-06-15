package ingestion

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	sv "github.com/madsan/intelligence/internal/enrichment/vessel/shipvault"
)

func (s *Service) upsertVesselNameHistory(ctx context.Context, vesselID uuid.UUID, mmsi, imo string, entries []sv.NameHistoryEntry, fetchedAt time.Time) error {
	if mmsi == "" || len(entries) == 0 {
		return nil
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM vessel_name_history WHERE mmsi = $1`, mmsi)
	if err != nil {
		return err
	}
	for i, e := range entries {
		raw, _ := json.Marshal(e)
		_, err := s.pool.Exec(ctx, `
			INSERT INTO vessel_name_history (
				vessel_id, mmsi, imo, seq, name, from_date, to_date, disponent,
				source, tier, fetched_at, raw_payload
			) VALUES ($1,$2,NULLIF($3,''),$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),
				'shipvault','observed',$9,$10)
		`, vesselID, mmsi, imo, i, e.Name, e.FromDate, e.ToDate, e.Disponent, fetchedAt, raw)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) upsertShipVaultCompany(ctx context.Context, detail *sv.CompanyDetail, madsanCompanyID uuid.UUID, staleDays int) error {
	if detail == nil || detail.ShipVaultCompanyID == "" {
		return nil
	}
	if staleDays <= 0 {
		staleDays = 180
	}
	fleet, _ := json.Marshal(detail.Fleet)
	raw, _ := json.Marshal(detail.Raw)
	now := time.Now().UTC()
	_, err := s.pool.Exec(ctx, `
		INSERT INTO shipvault_companies (
			shipvault_company_id, name, country, city, parent_name, parent_company_id,
			fleet_size, total_dwt, total_gt, avg_age_years, fleet_list, madsan_company_id,
			source, tier, fetched_at, stale_after, raw_payload, updated_at
		) VALUES (
			$1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),
			$7,$8,$9,$10,$11,NULLIF($12::text,'')::uuid,
			'shipvault','observed',$13,$14,$15,now()
		)
		ON CONFLICT (shipvault_company_id) DO UPDATE SET
			name = COALESCE(NULLIF(EXCLUDED.name,''), shipvault_companies.name),
			country = COALESCE(NULLIF(EXCLUDED.country,''), shipvault_companies.country),
			city = COALESCE(NULLIF(EXCLUDED.city,''), shipvault_companies.city),
			parent_name = COALESCE(NULLIF(EXCLUDED.parent_name,''), shipvault_companies.parent_name),
			parent_company_id = COALESCE(NULLIF(EXCLUDED.parent_company_id,''), shipvault_companies.parent_company_id),
			fleet_size = COALESCE(EXCLUDED.fleet_size, shipvault_companies.fleet_size),
			total_dwt = COALESCE(EXCLUDED.total_dwt, shipvault_companies.total_dwt),
			total_gt = COALESCE(EXCLUDED.total_gt, shipvault_companies.total_gt),
			avg_age_years = COALESCE(EXCLUDED.avg_age_years, shipvault_companies.avg_age_years),
			fleet_list = EXCLUDED.fleet_list,
			madsan_company_id = COALESCE(EXCLUDED.madsan_company_id, shipvault_companies.madsan_company_id),
			fetched_at = EXCLUDED.fetched_at,
			stale_after = EXCLUDED.stale_after,
			raw_payload = EXCLUDED.raw_payload,
			updated_at = now()
	`, detail.ShipVaultCompanyID, detail.Name, detail.Country, detail.City, detail.ParentName, detail.ParentID,
		detail.FleetSize, nullFloat(detail.TotalDWT), nullFloat(detail.TotalGT), nullFloat(detail.AvgAgeYears),
		fleet, nullableUUID(madsanCompanyID), now, now.Add(time.Duration(staleDays)*24*time.Hour), raw)
	return err
}

func (s *Service) shipVaultCompanyFresh(ctx context.Context, companyID string, force bool) bool {
	if force || companyID == "" {
		return false
	}
	var staleAfter *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT stale_after FROM shipvault_companies WHERE shipvault_company_id = $1
	`, companyID).Scan(&staleAfter)
	if err != nil || staleAfter == nil {
		return false
	}
	return staleAfter.After(time.Now())
}

func (s *Service) upsertShipVaultYard(ctx context.Context, detail *sv.YardDetail, staleDays int) error {
	if detail == nil || detail.ShipVaultYardID == "" {
		return nil
	}
	if staleDays <= 0 {
		staleDays = 180
	}
	fleet, _ := json.Marshal(detail.VesselsBuilt)
	raw, _ := json.Marshal(detail.Raw)
	now := time.Now().UTC()
	_, err := s.pool.Exec(ctx, `
		INSERT INTO shipvault_yards (
			shipvault_yard_id, name, country, location, vessels_built,
			source, tier, fetched_at, stale_after, raw_payload, updated_at
		) VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),$5,
			'shipvault','observed',$6,$7,$8,now())
		ON CONFLICT (shipvault_yard_id) DO UPDATE SET
			name = COALESCE(NULLIF(EXCLUDED.name,''), shipvault_yards.name),
			country = COALESCE(NULLIF(EXCLUDED.country,''), shipvault_yards.country),
			location = COALESCE(NULLIF(EXCLUDED.location,''), shipvault_yards.location),
			vessels_built = EXCLUDED.vessels_built,
			fetched_at = EXCLUDED.fetched_at,
			stale_after = EXCLUDED.stale_after,
			raw_payload = EXCLUDED.raw_payload,
			updated_at = now()
	`, detail.ShipVaultYardID, detail.Name, detail.Country, detail.Location, fleet,
		now, now.Add(time.Duration(staleDays)*24*time.Hour), raw)
	return err
}

func (s *Service) shipVaultYardFresh(ctx context.Context, yardID string, force bool) bool {
	if force || yardID == "" {
		return false
	}
	var staleAfter *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT stale_after FROM shipvault_yards WHERE shipvault_yard_id = $1
	`, yardID).Scan(&staleAfter)
	if err != nil || staleAfter == nil {
		return false
	}
	return staleAfter.After(time.Now())
}

func (s *Service) upsertVesselYardLink(ctx context.Context, vesselID uuid.UUID, mmsi, imo string, detail *sv.VesselDetail, fetchedAt time.Time) error {
	if detail == nil || mmsi == "" {
		return nil
	}
	yardID := detail.YardID
	yardName := detail.YardName
	if yardID == "" && yardName == "" {
		return nil
	}
	if yardID == "" {
		return nil
	}
	raw, _ := json.Marshal(map[string]any{
		"yard_name":   yardName,
		"yard_number": detail.YardNumber,
		"builder":     detail.Builder,
	})
	var buildYear *int
	if detail.BuildYear > 0 {
		y := detail.BuildYear
		buildYear = &y
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO vessel_yard_links (
			mmsi, vessel_id, imo, shipvault_yard_id, yard_number, build_year,
			source, tier, fetched_at, raw_payload
		) VALUES ($1,$2,NULLIF($3,''),$4,NULLIF($5,''),$6,
			'shipvault','observed',$7,$8)
		ON CONFLICT (mmsi, shipvault_yard_id) DO UPDATE SET
			vessel_id = EXCLUDED.vessel_id,
			imo = COALESCE(NULLIF(EXCLUDED.imo,''), vessel_yard_links.imo),
			yard_number = COALESCE(NULLIF(EXCLUDED.yard_number,''), vessel_yard_links.yard_number),
			build_year = COALESCE(EXCLUDED.build_year, vessel_yard_links.build_year),
			fetched_at = EXCLUDED.fetched_at,
			raw_payload = EXCLUDED.raw_payload
	`, mmsi, vesselID, imo, yardID, detail.YardNumber, buildYear, fetchedAt, raw)
	return err
}

func nullFloat(v float64) any {
	if v == 0 {
		return nil
	}
	return v
}
