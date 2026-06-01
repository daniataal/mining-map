package api

import (
	"fmt"
	"net/http"
	"time"
)

// CorridorDeltaRow compares recent vs baseline MCR corridor volume by country pair.
type CorridorDeltaRow struct {
	LoadCountry      string   `json:"load_country"`
	DischargeCountry string   `json:"discharge_country"`
	CommodityFamily  string   `json:"commodity_family"`
	RecentCount      int      `json:"recent_count"`
	BaselineCount    int      `json:"baseline_count"`
	DeltaCount       int      `json:"delta_count"`
	DeltaPct         *float64 `json:"delta_pct,omitempty"`
	AvgConfidence    *float64 `json:"avg_confidence,omitempty"`
}

// CorridorDelta returns corridors with rising activity (recent window vs baseline).
// GET /api/oil-live/corridors/delta?window_days=30&baseline_days=90&limit=50&commodity=
func (s *Server) CorridorDelta(w http.ResponseWriter, r *http.Request) {
	windowDays := queryInt(r, "window_days", 30)
	if windowDays < 7 || windowDays > 120 {
		windowDays = 30
	}
	baselineDays := queryInt(r, "baseline_days", 90)
	if baselineDays < windowDays+7 || baselineDays > 365 {
		baselineDays = 90
	}
	limit := queryInt(r, "limit", 50)
	if limit > 200 {
		limit = 200
	}
	commodity := r.URL.Query().Get("commodity")
	minLat := queryFloat(r, "min_lat", 0)
	maxLat := queryFloat(r, "max_lat", 0)
	minLng := queryFloat(r, "min_lng", 0)
	maxLng := queryFloat(r, "max_lng", 0)
	hasBbox := maxLat > minLat && maxLng > minLng

	sql := fmt.Sprintf(`
		SELECT
			load_country,
			discharge_country,
			commodity_family,
			COUNT(*) FILTER (
				WHERE COALESCE(event_date, created_at::date) >= CURRENT_DATE - interval '%d days'
			)::int AS recent_count,
			COUNT(*) FILTER (
				WHERE COALESCE(event_date, created_at::date) >= CURRENT_DATE - interval '%d days'
				  AND COALESCE(event_date, created_at::date) < CURRENT_DATE - interval '%d days'
			)::int AS baseline_count,
			AVG(confidence)::float8 AS avg_confidence
		FROM meridian_cargo_records
		WHERE load_country IS NOT NULL
		  AND discharge_country IS NOT NULL
		  AND commodity_family IS NOT NULL
		  AND confidence >= 0.45
		  AND corridor_load_lat IS NOT NULL
		  AND corridor_discharge_lat IS NOT NULL
	`, windowDays, baselineDays, windowDays)
	args := []any{}
	n := 1
	if commodity != "" {
		sql += fmt.Sprintf(` AND commodity_family = $%d`, n)
		args = append(args, commodity)
		n++
	}
	if hasBbox {
		sql += fmt.Sprintf(`
		  AND corridor_load_lat BETWEEN $%d AND $%d
		  AND corridor_load_lng BETWEEN $%d AND $%d
		`, n, n+1, n+2, n+3)
		args = append(args, minLat, maxLat, minLng, maxLng)
		n += 4
	}
	sql += `
		GROUP BY load_country, discharge_country, commodity_family
		HAVING COUNT(*) FILTER (
			WHERE COALESCE(event_date, created_at::date) >= CURRENT_DATE - interval '` + fmt.Sprint(windowDays) + ` days'
		) > 0
		ORDER BY (
			COUNT(*) FILTER (
				WHERE COALESCE(event_date, created_at::date) >= CURRENT_DATE - interval '` + fmt.Sprint(windowDays) + ` days'
			) - COUNT(*) FILTER (
				WHERE COALESCE(event_date, created_at::date) >= CURRENT_DATE - interval '` + fmt.Sprint(baselineDays) + ` days'
				  AND COALESCE(event_date, created_at::date) < CURRENT_DATE - interval '` + fmt.Sprint(windowDays) + ` days'
			)
		) DESC
	`
	sql += fmt.Sprintf(` LIMIT $%d`, n)
	args = append(args, limit)

	rows, err := s.Pool.Query(r.Context(), sql, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	out := make([]CorridorDeltaRow, 0)
	for rows.Next() {
		var row CorridorDeltaRow
		if err := rows.Scan(
			&row.LoadCountry, &row.DischargeCountry, &row.CommodityFamily,
			&row.RecentCount, &row.BaselineCount, &row.AvgConfidence,
		); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		row.DeltaCount = row.RecentCount - row.BaselineCount
		if row.BaselineCount > 0 {
			pct := float64(row.DeltaCount) / float64(row.BaselineCount) * 100
			row.DeltaPct = &pct
		}
		out = append(out, row)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"window_days":   windowDays,
		"baseline_days": baselineDays,
		"corridors":     out,
		"count":         len(out),
		"disclaimer":    "MCR corridor activity delta — synthetic/inferred tiers; not customs BOL.",
		"generated_at":  time.Now().UTC().Format(time.RFC3339),
	})
}
