package api

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type scenarioCorridorRow struct {
	LoadCountry      string   `json:"load_country"`
	DischargeCountry string   `json:"discharge_country"`
	CommodityFamily  string   `json:"commodity_family"`
	CargoCount       int      `json:"cargo_count"`
	AvgConfidence    *float64 `json:"avg_confidence,omitempty"`
}

func queryTopCorridorsInBbox(
	ctx context.Context,
	pool *pgxpool.Pool,
	minLat, minLng, maxLat, maxLng float64,
	commodity string,
	limit int,
) []scenarioCorridorRow {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	out := []scenarioCorridorRow{}
	sql := `
		SELECT load_country, discharge_country, commodity_family, cargo_count, avg_confidence
		FROM mcr_corridor_aggregates_country
		WHERE origin_lat BETWEEN $1 AND $2
		  AND origin_lng BETWEEN $3 AND $4`
	args := []any{minLat, maxLat, minLng, maxLng}
	argN := 5
	if vals := commodityFilterValues(commodity); len(vals) > 0 {
		sql += fmt.Sprintf(" AND commodity_family = ANY($%d)", argN)
		args = append(args, vals)
		argN++
	}
	sql += fmt.Sprintf(" ORDER BY cargo_count DESC NULLS LAST LIMIT $%d", argN)
	args = append(args, limit)
	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var row scenarioCorridorRow
		if err := rows.Scan(&row.LoadCountry, &row.DischargeCountry, &row.CommodityFamily, &row.CargoCount, &row.AvgConfidence); err != nil {
			return out
		}
		out = append(out, row)
	}
	return out
}
