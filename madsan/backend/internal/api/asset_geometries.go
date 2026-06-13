package api

import (
	"encoding/json"
	"net/http"
	"strings"
)

func (s *Server) listIntelAssetGeometries(w http.ResponseWriter, r *http.Request) {
	useBBox, minLng, minLat, maxLng, maxLat := parseBBOX(r.URL.Query().Get("bbox"))
	assetID := strings.TrimSpace(r.URL.Query().Get("asset_id"))
	if !useBBox && assetID == "" {
		http.Error(w, "bbox is required unless asset_id is supplied", http.StatusBadRequest)
		return
	}
	if !useBBox {
		minLng, minLat, maxLng, maxLat = -180, -90, 180, 90
	}
	limit := boundedLimit(r.URL.Query().Get("limit"), 200, 500)
	source := strings.TrimSpace(r.URL.Query().Get("source"))
	assetType := strings.TrimSpace(r.URL.Query().Get("asset_type"))

	rows, err := s.pool.Query(r.Context(), `
		WITH env AS (
			SELECT ST_MakeEnvelope($4, $5, $6, $7, 4326) AS geom
		)
		SELECT
			ag.id::text,
			COALESCE(ag.asset_id::text, ''),
			COALESCE(a.name, ''),
			COALESCE(a.asset_type, ''),
			ag.source_key,
			COALESCE(ag.source_asset_id, ''),
			COALESCE(ag.geometry_type, ''),
			ST_AsGeoJSON(COALESCE(ag.geom_simplified, ag.geom)) AS geojson,
			COALESCE(ag.properties, '{}'::jsonb)::text
		FROM asset_geometries ag
		LEFT JOIN assets a ON a.id = ag.asset_id
		CROSS JOIN env
		WHERE ($1 = '' OR ag.source_key = $1)
		  AND ($2 = '' OR a.asset_type = $2)
		  AND ($3 = '' OR ag.asset_id::text = $3)
		  AND (
			NOT $8::boolean
			OR (
				ag.geom_simplified IS NOT NULL
				AND ag.geom_simplified && env.geom
				AND ST_Intersects(ag.geom_simplified, env.geom)
			)
			OR (
				ag.geom_simplified IS NULL
				AND ag.geom && env.geom
				AND ST_Intersects(ag.geom, env.geom)
			)
		  )
		ORDER BY COALESCE(a.confidence_score, 0) DESC, ag.created_at DESC
		LIMIT $9
	`, source, assetType, assetID, minLng, minLat, maxLng, maxLat, useBBox, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	features := []map[string]any{}
	for rows.Next() {
		var id, assetID, assetName, typ, sourceKey, sourceAssetID, geometryType, geoJSON, properties string
		if err := rows.Scan(&id, &assetID, &assetName, &typ, &sourceKey, &sourceAssetID, &geometryType, &geoJSON, &properties); err != nil {
			continue
		}
		var geom any
		if json.Unmarshal([]byte(geoJSON), &geom) != nil {
			continue
		}
		features = append(features, map[string]any{
			"type":     "Feature",
			"geometry": geom,
			"properties": map[string]any{
				"id":              id,
				"asset_id":        assetID,
				"asset_name":      assetName,
				"asset_type":      typ,
				"source_key":      sourceKey,
				"source_asset_id": sourceAssetID,
				"geometry_type":   geometryType,
				"evidence_label":  "reported",
				"raw":             jsonBlock(properties, "{}"),
			},
		})
	}
	writeJSON(w, map[string]any{
		"type":       "FeatureCollection",
		"count":      len(features),
		"features":   features,
		"simplified": true,
		"bbox":       []float64{minLng, minLat, maxLng, maxLat},
		"message":    "BBox-filtered simplified asset geometries from normalized PostGIS storage.",
	})
}
