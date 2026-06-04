package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mining-map/oil-live-intel/internal/overpass"
	"github.com/mining-map/oil-live-intel/internal/services/osmtiles"
)

func petroleumMapboxDisabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("PETROLEUM_DISABLE_MAPBOX")))
	if v == "1" || v == "true" || v == "yes" || v == "on" {
		return true
	}
	if strings.TrimSpace(os.Getenv("MAPBOX_ACCESS_TOKEN")) == "" &&
		strings.TrimSpace(os.Getenv("OILMAP_MAPBOX_TOKEN")) == "" {
		return true
	}
	return false
}

var OSMLayers = map[string]map[string]string{
	"pipelines": {
		"label":           "Oil/gas pipelines (OSM)",
		"geometry":        "line",
		"overpass_filter": `way["man_made"="pipeline"]`,
	},
	"refineries": {
		"label":           "Refineries (OSM)",
		"geometry":        "point",
		"overpass_filter": `nwr["industrial"="refinery"]`,
	},
	"storage_terminals": {
		"label":           "Petroleum storage terminals (OSM)",
		"geometry":        "point",
		"overpass_filter": "",
	},
}

func simplifyToleranceForZoom(zoom float64) float64 {
	if zoom >= 10 {
		return 0.0
	}
	if zoom >= 8 {
		return 0.02
	}
	return math.Min(0.35, 0.04*math.Pow(2, 8-zoom))
}

func (s *Server) OSMLayersCatalog(w http.ResponseWriter, r *http.Request) {
	layers := []map[string]interface{}{}
	for id, meta := range OSMLayers {
		layers = append(layers, map[string]interface{}{
			"id":                id,
			"label":             meta["label"],
			"geometry":          meta["geometry"],
			"default_visible":   false,
			"attribution":       "© OpenStreetMap contributors",
			"license_note":      "ODbL — community-mapped; not official cadastre.",
			"tile_url_template": osmtiles.TileURLTempl,
			"render_mode":       "mvt",
			"source_layer":      osmtiles.MVTLayerName,
			"min_zoom":          osmtiles.MinZoomForLayer(id),
		})
	}

	mapboxOff := petroleumMapboxDisabled()
	limitations := []string{
		"Community-mapped OSM data; coverage and accuracy vary by region.",
		"Respect Overpass rate limits — large views are tile-chunked and cached.",
	}
	if mapboxOff {
		limitations = append(limitations,
			"Mapbox oilmap layers are disabled — use OSM petroleum layers as the default infrastructure source.",
		)
	} else {
		limitations = append(limitations,
			"Does not replace Mapbox oilmap layers; opt-in only when Mapbox token is configured.",
		)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"layers":          layers,
		"data_as_of":      time.Now().UTC().Format(time.RFC3339),
		"mapbox_disabled": mapboxOff,
		"render_mode":     "mvt",
		"source_labels": []string{
			"OpenStreetMap",
			"Overpass API",
		},
		"limitations": limitations,
	})
}

func (s *Server) OSMLayerMVT(w http.ResponseWriter, r *http.Request) {
	layerID := chi.URLParam(r, "layer_id")
	if _, ok := OSMLayers[layerID]; !ok {
		http.Error(w, fmt.Sprintf("Unknown OSM petroleum layer: %s", layerID), http.StatusNotFound)
		return
	}

	z, err := strconv.Atoi(chi.URLParam(r, "z"))
	if err != nil {
		http.Error(w, "invalid z", http.StatusBadRequest)
		return
	}
	x, err := strconv.Atoi(chi.URLParam(r, "x"))
	if err != nil {
		http.Error(w, "invalid x", http.StatusBadRequest)
		return
	}
	y, err := strconv.Atoi(chi.URLParam(r, "y"))
	if err != nil {
		http.Error(w, "invalid y", http.StatusBadRequest)
		return
	}
	if s.Pool == nil {
		http.Error(w, "database unavailable", http.StatusServiceUnavailable)
		return
	}

	tile, err := osmtiles.FetchTile(r.Context(), s.Pool, layerID, z, x, y)
	if err != nil {
		if errors.Is(err, osmtiles.ErrUnknownLayer) {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		http.Error(w, fmt.Sprintf("tile fetch failed: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	if len(tile) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(tile)
}

func (s *Server) OSMLayerGeoJSON(w http.ResponseWriter, r *http.Request) {
	layerID := chi.URLParam(r, "layer_id")
	if _, ok := OSMLayers[layerID]; !ok {
		http.Error(w, fmt.Sprintf("Unknown OSM petroleum layer: %s", layerID), http.StatusNotFound)
		return
	}

	var bbox []float64
	south, _ := strconv.ParseFloat(r.URL.Query().Get("south"), 64)
	west, _ := strconv.ParseFloat(r.URL.Query().Get("west"), 64)
	north, _ := strconv.ParseFloat(r.URL.Query().Get("north"), 64)
	east, _ := strconv.ParseFloat(r.URL.Query().Get("east"), 64)

	if r.URL.Query().Get("south") != "" {
		bbox = []float64{south, west, north, east}
	}

	zoom, _ := strconv.ParseFloat(r.URL.Query().Get("zoom"), 64)

	// Check DB first
	hasCached := false
	s.Pool.QueryRow(r.Context(), "SELECT 1 FROM petroleum_osm_features WHERE layer_id = $1 LIMIT 1", layerID).Scan(&hasCached)

	if hasCached {
		payload, err := s.getLayerGeoJSONFromDB(r.Context(), layerID, bbox, zoom)
		if err == nil {
			if payload["feature_count"].(int) > 0 || bbox == nil {
				writeJSONCached(w, http.StatusOK, payload, 600)
				return
			}
		}
	}

	// Live Overpass fallback
	client := overpass.NewClient()
	searchBbox := bbox
	if searchBbox == nil {
		searchBbox = []float64{-55.0, -180.0, 84.0, 180.0}
	}
	query := overpass.BuildQuery(layerID, searchBbox)
	elements, err := client.Fetch(r.Context(), query)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
			"type":          "FeatureCollection",
			"features":      []interface{}{},
			"layer_id":      layerID,
			"feature_count": 0,
			"data_as_of":    time.Now().UTC().Format(time.RFC3339),
			"limitations":   []string{fmt.Sprintf("OSM petroleum layer fetch failed: %v", err)},
		})
		return
	}

	features := []map[string]interface{}{}
	for _, el := range elements {
		feat := elementToFeatureMap(layerID, el)
		if feat != nil {
			// In bbox?
			if featureInBbox(feat, searchBbox) {
				features = append(features, feat)
			}
		}
	}

	writeJSONCached(w, http.StatusOK, map[string]interface{}{
		"type":          "FeatureCollection",
		"features":      features,
		"layer_id":      layerID,
		"label":         OSMLayers[layerID]["label"],
		"bbox":          bbox,
		"feature_count": len(features),
		"data_as_of":    time.Now().UTC().Format(time.RFC3339),
		"attribution":   "© OpenStreetMap contributors (ODbL)",
		"license_note":  "Community OSM — not official government cadastre.",
		"source":        "overpass",
		"cached":        false,
	}, 600)
}

func featureInBbox(feat map[string]interface{}, bbox []float64) bool {
	if bbox == nil {
		return true
	}
	geom, ok := feat["geometry"].(map[string]interface{})
	if !ok {
		return true
	}
	gtype, _ := geom["type"].(string)
	coordsInter, ok := geom["coordinates"].([]interface{})
	if !ok || len(coordsInter) == 0 {
		return true
	}

	bs, bw, bn, be := bbox[0], bbox[1], bbox[2], bbox[3]

	pointOK := func(lng, lat float64) bool {
		return lat >= bs && lat <= bn && lng >= bw && lng <= be
	}

	if gtype == "Point" {
		if len(coordsInter) >= 2 {
			lng, _ := coordsInter[0].(float64)
			lat, _ := coordsInter[1].(float64)
			return pointOK(lng, lat)
		}
	} else if gtype == "LineString" {
		for _, pt := range coordsInter {
			c, ok := pt.([]interface{})
			if ok && len(c) >= 2 {
				lng, _ := c[0].(float64)
				lat, _ := c[1].(float64)
				if pointOK(lng, lat) {
					return true
				}
			}
		}
	}
	return false
}

func elementToFeatureMap(layerID string, el overpass.Element) map[string]interface{} {
	name := el.Tags["name"]
	if name == "" {
		name = el.Tags["operator"]
	}
	if name == "" {
		name = el.Tags["owner"]
	}
	if name == "" {
		name = fmt.Sprintf("OSM %s %d", el.Type, el.ID)
	}

	var geom map[string]interface{}

	if layerID == "pipelines" && el.Type == "way" {
		if len(el.Geometry) < 2 {
			return nil
		}
		var coords [][]float64
		for _, pt := range el.Geometry {
			coords = append(coords, []float64{pt.Lon, pt.Lat})
		}
		if len(coords) < 2 {
			return nil
		}
		geom = map[string]interface{}{
			"type":        "LineString",
			"coordinates": coords,
		}
	} else if layerID == "refineries" || layerID == "storage_terminals" {
		var lat, lon float64
		if el.Center != nil {
			lat, lon = el.Center.Lat, el.Center.Lon
		} else if el.Lat != nil && el.Lon != nil {
			lat, lon = *el.Lat, *el.Lon
		} else if len(el.Geometry) > 0 {
			var sumLat, sumLon float64
			for _, pt := range el.Geometry {
				sumLat += pt.Lat
				sumLon += pt.Lon
			}
			lat = sumLat / float64(len(el.Geometry))
			lon = sumLon / float64(len(el.Geometry))
		} else {
			return nil
		}
		geom = map[string]interface{}{
			"type":        "Point",
			"coordinates": []float64{lon, lat},
		}
	} else {
		return nil
	}

	props := map[string]interface{}{
		"name":        name,
		"layer_id":    layerID,
		"osm_type":    el.Type,
		"osm_id":      el.ID,
		"source":      "openstreetmap",
		"attribution": "© OpenStreetMap contributors (ODbL)",
	}

	for k, v := range el.Tags {
		props[k] = v
	}

	return map[string]interface{}{
		"type":       "Feature",
		"id":         fmt.Sprintf("osm/%s/%d", el.Type, el.ID),
		"geometry":   geom,
		"properties": props,
	}
}

func (s *Server) getLayerGeoJSONFromDB(ctx context.Context, layerID string, bbox []float64, zoom float64) (map[string]interface{}, error) {
	tolerance := simplifyToleranceForZoom(zoom)
	args := []interface{}{layerID}
	
	bboxClause := ""
	if bbox != nil {
		bboxClause = `AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 4326))`
		args = append(args, bbox[1], bbox[0], bbox[3], bbox[2])
	}

	geomSQL := "ST_AsGeoJSON(geom)::json"
	if tolerance > 0 {
		geomSQL = fmt.Sprintf("ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom::geometry, %f))::json", tolerance)
	}

	query := fmt.Sprintf(`
		SELECT osm_type, osm_id, tags, %s
		FROM petroleum_osm_features
		WHERE layer_id = $1 %s
		ORDER BY osm_id
		LIMIT 50000
	`, geomSQL, bboxClause)

	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	features := []map[string]interface{}{}
	for rows.Next() {
		var osmType string
		var osmID int64
		var tags []byte
		var geom []byte
		if err := rows.Scan(&osmType, &osmID, &tags, &geom); err != nil {
			continue
		}

		var tagsMap map[string]interface{}
		json.Unmarshal(tags, &tagsMap)
		if tagsMap == nil {
			tagsMap = make(map[string]interface{})
		}

		var geomMap map[string]interface{}
		json.Unmarshal(geom, &geomMap)

		name, _ := tagsMap["name"].(string)
		if name == "" {
			name, _ = tagsMap["operator"].(string)
		}
		if name == "" {
			name = fmt.Sprintf("OSM %s %d", osmType, osmID)
		}

		tagsMap["name"] = name
		tagsMap["layer_id"] = layerID
		tagsMap["osm_type"] = osmType
		tagsMap["osm_id"] = osmID
		tagsMap["source"] = "openstreetmap"
		tagsMap["attribution"] = "© OpenStreetMap contributors (ODbL)"
		tagsMap["persisted"] = true

		features = append(features, map[string]interface{}{
			"type":       "Feature",
			"id":         fmt.Sprintf("osm/%s/%d", osmType, osmID),
			"geometry":   geomMap,
			"properties": tagsMap,
		})
	}

	var count int
	var fetchedAt time.Time
	s.Pool.QueryRow(ctx, "SELECT COUNT(*)::int, MAX(fetched_at) FROM petroleum_osm_features WHERE layer_id = $1", layerID).Scan(&count, &fetchedAt)

	return map[string]interface{}{
		"type":              "FeatureCollection",
		"features":          features,
		"layer_id":          layerID,
		"label":             OSMLayers[layerID]["label"],
		"bbox":              bbox,
		"feature_count":     len(features),
		"data_as_of":        fetchedAt.UTC().Format(time.RFC3339),
		"attribution":       "© OpenStreetMap contributors (ODbL)",
		"license_note":      "Community OSM — persisted snapshot; not official cadastre.",
		"source":            "database",
		"cached":            true,
		"db_feature_total":  count,
	}, nil
}
