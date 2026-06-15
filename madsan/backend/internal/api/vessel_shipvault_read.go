package api

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type vesselNameHistoryRow struct {
	Name      string
	FromDate  string
	ToDate    string
	Disponent string
}

func loadVesselNameHistory(ctx context.Context, pool *pgxpool.Pool, mmsi string) []map[string]any {
	if mmsi == "" {
		return nil
	}
	rows, err := pool.Query(ctx, `
		SELECT name, COALESCE(from_date,''), COALESCE(to_date,''), COALESCE(disponent,'')
		FROM vessel_name_history
		WHERE mmsi = $1
		ORDER BY seq ASC
	`, mmsi)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var r vesselNameHistoryRow
		if err := rows.Scan(&r.Name, &r.FromDate, &r.ToDate, &r.Disponent); err != nil {
			continue
		}
		entry := map[string]any{"name": r.Name}
		if r.FromDate != "" {
			entry["from_date"] = r.FromDate
		}
		if r.ToDate != "" {
			entry["to_date"] = r.ToDate
		}
		if r.Disponent != "" {
			entry["disponent"] = r.Disponent
		}
		out = append(out, entry)
	}
	return out
}

func loadVesselShipvaultOwner(ctx context.Context, pool *pgxpool.Pool, ownerCompanyID string) map[string]any {
	if ownerCompanyID == "" {
		return nil
	}
	var name, country, city, parentName, parentID string
	var fleetSize *int
	var totalDWT, totalGT, avgAge *float64
	var madsanCompanyID *uuid.UUID
	var fetchedAt *time.Time
	err := pool.QueryRow(ctx, `
		SELECT name, COALESCE(country,''), COALESCE(city,''), COALESCE(parent_name,''), COALESCE(parent_company_id,''),
		       fleet_size, total_dwt, total_gt, avg_age_years,
		       madsan_company_id, fetched_at
		FROM shipvault_companies
		WHERE shipvault_company_id = $1
	`, ownerCompanyID).Scan(&name, &country, &city, &parentName, &parentID, &fleetSize, &totalDWT, &totalGT, &avgAge, &madsanCompanyID, &fetchedAt)
	if err != nil {
		return nil
	}
	out := map[string]any{
		"shipvault_company_id": ownerCompanyID,
		"name":                 name,
	}
	if country != "" {
		out["country"] = country
	}
	if city != "" {
		out["city"] = city
	}
	if parentName != "" {
		out["parent_name"] = parentName
	}
	if parentID != "" {
		out["parent_company_id"] = parentID
	}
	if fleetSize != nil {
		out["fleet_size"] = *fleetSize
	}
	if totalDWT != nil {
		out["total_dwt"] = *totalDWT
	}
	if totalGT != nil {
		out["total_gt"] = *totalGT
	}
	if avgAge != nil {
		out["avg_age_years"] = *avgAge
	}
	if madsanCompanyID != nil {
		out["madsan_company_id"] = madsanCompanyID.String()
	}
	if fetchedAt != nil {
		out["fetched_at"] = fetchedAt.UTC().Format(time.RFC3339)
	}
	return out
}

func loadVesselYardSummary(ctx context.Context, pool *pgxpool.Pool, mmsi string) map[string]any {
	if mmsi == "" {
		return nil
	}
	var yardID, yardName, yardNumber string
	var buildYear *int
	err := pool.QueryRow(ctx, `
		SELECT l.shipvault_yard_id, COALESCE(y.name,''), COALESCE(l.yard_number,''), l.build_year
		FROM vessel_yard_links l
		LEFT JOIN shipvault_yards y ON y.shipvault_yard_id = l.shipvault_yard_id
		WHERE l.mmsi = $1
		ORDER BY l.fetched_at DESC
		LIMIT 1
	`, mmsi).Scan(&yardID, &yardName, &yardNumber, &buildYear)
	if err != nil {
		return nil
	}
	out := map[string]any{
		"shipvault_yard_id": yardID,
		"name":              yardName,
	}
	if yardNumber != "" {
		out["yard_number"] = yardNumber
	}
	if buildYear != nil {
		out["build_year"] = *buildYear
	}
	return out
}

func mergeVesselShipvaultSummary(summary map[string]any, mmsi string, _ []byte, ctx context.Context, pool *pgxpool.Pool) {
	if summary == nil || mmsi == "" {
		return
	}
	var hist []map[string]any
	if hist = loadVesselNameHistory(ctx, pool, mmsi); len(hist) > 0 {
		summary["name_history"] = hist
	}
	var ownerID string
	if op, ok := summary["owner_profile"].(map[string]any); ok {
		if id, ok := op["shipvault_company_id"].(string); ok {
			ownerID = id
		}
	}
	if ownerID != "" {
		if extra := loadVesselShipvaultOwner(ctx, pool, ownerID); extra != nil {
			if existing, ok := summary["owner_profile"].(map[string]any); ok {
				for k, v := range extra {
					if _, set := existing[k]; !set {
						existing[k] = v
					}
				}
				summary["owner_profile"] = existing
			} else {
				summary["owner_profile"] = extra
			}
		}
	}
	if yard := loadVesselYardSummary(ctx, pool, mmsi); yard != nil {
		summary["yard"] = yard
	}
	ownerProfile, _ := summary["owner_profile"].(map[string]any)
	mergeVesselOwnershipIntel(summary, ownerProfile, loadVesselFleetMatch(ctx, pool, ownerID, mmsi, stringFromAny(summary["imo"]), hist))
}
