package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/mining-map/oil-live-intel/internal/services/vesselmerge"
)

const defaultVesselFreshnessMinutes = 1440

func (s *Server) ListVessels(w http.ResponseWriter, r *http.Request) {
	minLon, minLat, maxLon, maxLat, bboxOK := parseBBox(r.URL.Query().Get("bbox"))
	bbox := [4]float64{minLon, minLat, maxLon, maxLat}
	limit := queryInt(r, "limit", 500)
	if limit > 2000 {
		limit = 2000
	}
	freshness := queryInt(r, "freshness_minutes", defaultVesselFreshnessMinutes)
	sources := parseCSVParam(r.URL.Query().Get("sources"))

	items, err := vesselmerge.ListMergedVessels(r.Context(), s.Pool, bbox, bboxOK, limit, vesselmerge.QueryOptions{
		FreshnessMinutes: freshness,
		Sources:          sources,
	})
	if err != nil {
		fallback, fallbackErr := s.listLiveVessels(r, bbox, bboxOK, limit)
		if fallbackErr != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSONCached(w, http.StatusOK, map[string]any{
			"vessels":           fallback,
			"count":             len(fallback),
			"freshness_minutes": freshness,
			"sources":           sources,
			"source_mode":       "legacy_oil_ais_positions",
			"limitations": []string{
				"Multi-source vessel observations are not ready; using the legacy live AIS table.",
				"AIS is a movement signal only and does not confirm supplier or receiver.",
			},
		}, 15)
		return
	}
	writeJSONCached(w, http.StatusOK, map[string]any{
		"vessels":           items,
		"count":             len(items),
		"freshness_minutes": freshness,
		"sources":           sources,
		"source_mode":       "multi_source_observations",
		"limitations": []string{
			"Open AIS coverage is partial; sparse regions are coverage gaps, not proof of no vessel activity.",
			"AIS is a movement signal only and does not confirm supplier or receiver.",
		},
	}, 15)
}

func (s *Server) VesselCoverage(w http.ResponseWriter, r *http.Request) {
	minLon, minLat, maxLon, maxLat, bboxOK := parseBBox(r.URL.Query().Get("bbox"))
	if !bboxOK {
		writeErr(w, http.StatusBadRequest, "bbox required: minLon,minLat,maxLon,maxLat")
		return
	}
	bbox := [4]float64{minLon, minLat, maxLon, maxLat}
	freshness := queryInt(r, "freshness_minutes", 180)
	sources := parseCSVParam(r.URL.Query().Get("sources"))

	cells, err := s.queryCoverageCells(r, bbox, freshness, sources)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	zones, zoneErr := s.queryWatchZones(r, bbox, freshness)
	if zoneErr != nil {
		zones = []map[string]any{}
	}

	quality := "gap"
	totalVessels := 0
	for _, cell := range cells {
		if n, ok := cell["vessel_count"].(int); ok {
			totalVessels += n
		}
		q, _ := cell["coverage_quality"].(string)
		if q == "strong" {
			quality = "strong"
			break
		}
		if q == "fair" && quality != "strong" {
			quality = "fair"
		}
		if q == "sparse" && quality == "gap" {
			quality = "sparse"
		}
	}

	writeJSONCached(w, http.StatusOK, map[string]any{
		"coverage_cells":    cells,
		"watch_zones":       zones,
		"freshness_minutes": freshness,
		"sources":           sources,
		"summary": map[string]any{
			"coverage_quality": quality,
			"cell_count":       len(cells),
			"vessels_recent":   totalVessels,
			"watch_zone_count": len(zones),
		},
		"limitations": []string{
			"Coverage quality is derived from open AIS observations in the requested viewport.",
			"Empty or sparse cells indicate a data coverage gap, not confirmed vessel absence.",
		},
	}, 45)
}

func (s *Server) SourceHealth(w http.ResponseWriter, r *http.Request) {
	items, err := s.querySourceHealth(r)
	if err != nil {
		items = fallbackSourceHealth()
	}
	writeJSONCached(w, http.StatusOK, map[string]any{
		"sources": items,
		"count":   len(items),
		"limitations": []string{
			"Open-only AIS sources have uneven geography and freshness.",
			"True global near-real-time AIS normally requires licensed satellite AIS.",
		},
	}, 60)
}

func (s *Server) queryCoverageCells(r *http.Request, bbox [4]float64, freshnessMinutes int, sources []string) ([]map[string]any, error) {
	cellSize := 2.5
	q := `
		WITH recent AS (
		  SELECT
		    LOWER(COALESCE(NULLIF(source, ''), data_source)) AS source,
		    mmsi,
		    lat::double precision AS lat,
		    lng::double precision AS lng,
		    EXTRACT(EPOCH FROM (now() - COALESCE(position_time, observed_at)))::int AS freshness_seconds
		  FROM oil_vessel_position_observations
		  WHERE COALESCE(position_time, observed_at) > now() - ($1 || ' minutes')::interval
		    AND lat >= $2 AND lat <= $3 AND lng >= $4 AND lng <= $5`
	args := []any{freshnessMinutes, bbox[1], bbox[3], bbox[0], bbox[2]}
	n := 6
	if len(sources) > 0 {
		q += fmt.Sprintf(` AND LOWER(COALESCE(NULLIF(source, ''), data_source)) = ANY($%d::text[])`, n)
		args = append(args, sources)
		n++
	}
	q += `
		),
		cells AS (
		  SELECT
		    FLOOR(lat / $` + fmt.Sprint(n) + `) * $` + fmt.Sprint(n) + ` AS min_lat,
		    FLOOR(lng / $` + fmt.Sprint(n) + `) * $` + fmt.Sprint(n) + ` AS min_lng,
		    COUNT(*)::int AS observation_count,
		    COUNT(DISTINCT mmsi)::int AS vessel_count,
		    MIN(freshness_seconds)::int AS freshness_seconds,
		    ARRAY_AGG(DISTINCT source ORDER BY source) AS sources
		  FROM recent
		  GROUP BY 1, 2
		)
		SELECT min_lat, min_lng, min_lat + $` + fmt.Sprint(n) + ` AS max_lat, min_lng + $` + fmt.Sprint(n) + ` AS max_lng,
		       observation_count, vessel_count, freshness_seconds, sources
		FROM cells
		ORDER BY vessel_count DESC, freshness_seconds ASC
		LIMIT 400`
	args = append(args, cellSize)

	rows, err := s.Pool.Query(r.Context(), q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []map[string]any{}
	for rows.Next() {
		var minLat, minLng, maxLat, maxLng float64
		var observationCount, vesselCount, freshness int
		var sourceList []string
		if err := rows.Scan(&minLat, &minLng, &maxLat, &maxLng, &observationCount, &vesselCount, &freshness, &sourceList); err != nil {
			return nil, err
		}
		quality := coverageQuality(vesselCount)
		out = append(out, map[string]any{
			"cell_id":           fmt.Sprintf("%.2f:%.2f", minLat, minLng),
			"min_lat":           minLat,
			"min_lng":           minLng,
			"max_lat":           maxLat,
			"max_lng":           maxLng,
			"observation_count": observationCount,
			"vessel_count":      vesselCount,
			"freshness_seconds": freshness,
			"sources":           sourceList,
			"coverage_quality":  quality,
			"confidence":        coverageConfidence(vesselCount),
		})
	}
	return out, rows.Err()
}

func (s *Server) queryWatchZones(r *http.Request, bbox [4]float64, freshnessMinutes int) ([]map[string]any, error) {
	rows, err := s.Pool.Query(r.Context(), `
		SELECT
		  z.id, z.name, z.priority,
		  z.min_lat::double precision, z.min_lng::double precision,
		  z.max_lat::double precision, z.max_lng::double precision,
		  z.status, z.expected_gap_reason,
		  COUNT(DISTINCT o.mmsi)::int AS recent_vessel_count,
		  MAX(COALESCE(o.position_time, o.observed_at)) AS last_observation_at
		FROM maritime_watch_zones z
		LEFT JOIN oil_vessel_position_observations o
		  ON o.lat >= z.min_lat AND o.lat <= z.max_lat
		 AND o.lng >= z.min_lng AND o.lng <= z.max_lng
		 AND COALESCE(o.position_time, o.observed_at) > now() - ($1 || ' minutes')::interval
		WHERE NOT (z.max_lng < $2 OR z.min_lng > $3 OR z.max_lat < $4 OR z.min_lat > $5)
		GROUP BY z.id, z.name, z.priority, z.min_lat, z.min_lng, z.max_lat, z.max_lng, z.status, z.expected_gap_reason
		ORDER BY z.priority ASC
		LIMIT 30
	`, freshnessMinutes, bbox[0], bbox[2], bbox[1], bbox[3])
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, status string
		var reason *string
		var priority, recentCount int
		var minLat, minLng, maxLat, maxLng float64
		var lastObs *time.Time
		if err := rows.Scan(&id, &name, &priority, &minLat, &minLng, &maxLat, &maxLng, &status, &reason, &recentCount, &lastObs); err != nil {
			return nil, err
		}
		quality := "coverage_gap"
		if recentCount >= 20 {
			quality = "active"
		} else if recentCount > 0 {
			quality = "sparse"
		}
		out = append(out, map[string]any{
			"id":                  id,
			"name":                name,
			"priority":            priority,
			"min_lat":             minLat,
			"min_lng":             minLng,
			"max_lat":             maxLat,
			"max_lng":             maxLng,
			"status":              status,
			"expected_gap_reason": reason,
			"recent_vessel_count": recentCount,
			"last_observation_at": formatTimePtr(lastObs),
			"coverage_quality":    quality,
		})
	}
	return out, rows.Err()
}

func (s *Server) querySourceHealth(r *http.Request) ([]map[string]any, error) {
	rows, err := s.Pool.Query(r.Context(), `
		WITH obs AS (
		  SELECT
		    LOWER(COALESCE(NULLIF(source, ''), data_source)) AS source,
		    COUNT(*)::int AS observation_count,
		    COUNT(DISTINCT mmsi)::int AS vessel_count,
		    MAX(COALESCE(position_time, observed_at)) AS last_observation_at
		  FROM oil_vessel_position_observations
		  GROUP BY 1
		)
		SELECT
		  h.source, h.source_type, h.display_name, h.status, h.coverage_tier,
		  COALESCE(obs.observation_count, h.observation_count)::int,
		  COALESCE(obs.vessel_count, 0)::int,
		  COALESCE(obs.last_observation_at, h.last_observation_at),
		  h.limitations, h.source_url, h.metadata
		FROM maritime_source_health h
		LEFT JOIN obs ON obs.source = h.source
		ORDER BY
		  CASE h.source
		    WHEN 'aisstream' THEN 1
		    WHEN 'aishub' THEN 2
		    WHEN 'barentswatch' THEN 3
		    WHEN 'denmark_ais' THEN 4
		    WHEN 'sentinel1_sar' THEN 5
		    ELSE 20
		  END
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var source, sourceType, displayName, status, tier string
		var observationCount, vesselCount int
		var lastObs *time.Time
		var limitations []string
		var sourceURL *string
		var metadata []byte
		if err := rows.Scan(&source, &sourceType, &displayName, &status, &tier, &observationCount, &vesselCount, &lastObs, &limitations, &sourceURL, &metadata); err != nil {
			return nil, err
		}
		if source == "aisstream" && os.Getenv("AISSTREAM_API_KEY") != "" && observationCount > 0 {
			status = "ok"
		}
		out = append(out, map[string]any{
			"source":              source,
			"source_type":         sourceType,
			"display_name":        displayName,
			"status":              status,
			"coverage_tier":       tier,
			"observation_count":   observationCount,
			"vessel_count":        vesselCount,
			"last_observation_at": formatTimePtr(lastObs),
			"limitations":         limitations,
			"source_url":          sourceURL,
			"metadata":            jsonRawOrEmpty(metadata),
		})
	}
	return out, rows.Err()
}

func parseCSVParam(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		clean := strings.TrimSpace(strings.ToLower(part))
		if clean == "" || seen[clean] {
			continue
		}
		seen[clean] = true
		out = append(out, clean)
	}
	return out
}

func coverageQuality(vesselCount int) string {
	switch {
	case vesselCount >= 50:
		return "strong"
	case vesselCount >= 10:
		return "fair"
	case vesselCount > 0:
		return "sparse"
	default:
		return "gap"
	}
}

func coverageConfidence(vesselCount int) float64 {
	switch {
	case vesselCount >= 50:
		return 0.85
	case vesselCount >= 10:
		return 0.65
	case vesselCount > 0:
		return 0.35
	default:
		return 0.1
	}
}

func fallbackSourceHealth() []map[string]any {
	return []map[string]any{
		{
			"source":        "aisstream",
			"source_type":   "community_coastal_ais",
			"display_name":  "AISStream",
			"status":        "configured_if_key_present",
			"coverage_tier": "open_partial",
			"limitations": []string{
				"Open/community AIS feed; not full global coverage.",
				"Known sparse regions must be represented as coverage gaps, not vessel absence.",
			},
			"source_url": "https://aisstream.io/documentation.html",
		},
		{
			"source":        "aishub",
			"source_type":   "contributor_terrestrial_ais",
			"display_name":  "AISHub contributor network",
			"status":        "planned",
			"coverage_tier": "open_contributor",
			"limitations": []string{
				"Requires contributing receiver stations before free API access.",
				"Primary open path for Persian Gulf and Africa gap reduction.",
			},
			"source_url": "https://www.aishub.net/api",
		},
	}
}

func jsonRawOrEmpty(raw []byte) map[string]any {
	out := map[string]any{}
	if len(raw) == 0 {
		return out
	}
	_ = json.Unmarshal(raw, &out)
	return out
}
