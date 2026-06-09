package tiles

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/assets"
)

type Service struct {
	pool       *pgxpool.Pool
	legacyPool *pgxpool.Pool
}

func New(pool *pgxpool.Pool, legacyPool *pgxpool.Pool) *Service {
	return &Service{pool: pool, legacyPool: legacyPool}
}

func (s *Service) ServeMVT(w http.ResponseWriter, r *http.Request) {
	layer := chi.URLParam(r, "layer")
	z, _ := strconv.Atoi(chi.URLParam(r, "z"))
	x, _ := strconv.Atoi(chi.URLParam(r, "x"))
	y, _ := strconv.Atoi(chi.URLParam(r, "y"))

	table := "map_energy_assets"
	layerName := "energy_assets"
	switch layer {
	case "metals-assets":
		layerName = "metals_assets"
	case "vessels":
		table = "map_vessels"
		layerName = "vessels"
	case "energy-assets":
		table = "map_energy_assets"
		layerName = "energy_assets"
	case "pipelines":
		layerName = "petroleum_osm"
	default:
		http.Error(w, "unknown layer", http.StatusNotFound)
		return
	}

	var tile []byte
	var query string
	// Geometries are EPSG:4326; ST_TileEnvelope defaults to Web Mercator (3857).
	tileFilter := `ST_Transform(geom::geometry, 3857) && ST_TileEnvelope($1,$2,$3)`
	mvtGeom := `ST_AsMVTGeom(ST_Transform(geom::geometry, 3857), ST_TileEnvelope($1,$2,$3), 4096, 256, true)`
	switch layer {
	case "vessels":
		// Query live vessels table (not stale materialized view) for AIS freshness.
		query = `
			SELECT ST_AsMVT(mvt.*, $4) FROM (
				SELECT ` + mvtGeom + ` AS geom,
					id::text, name, mmsi,
					vessel_type,
					vessel_type AS ship_type,
					vessel_type AS asset_type,
					flag_country_code AS country_code,
					confidence_score,
					course,
					heading,
					speed_knots
				FROM vessels
				WHERE latitude IS NOT NULL AND longitude IS NOT NULL
				  AND geom IS NOT NULL AND ` + tileFilter + `
			) mvt`
	case "metals-assets":
		query = `
			SELECT ST_AsMVT(mvt.*, $4) FROM (
				SELECT ` + mvtGeom + ` AS geom,
					id::text, name, asset_type, country_code, confidence_score
				FROM assets
				WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND geom IS NOT NULL
				  AND (` + assets.MetalsMapWhereSQL + `)
				  AND ` + tileFilter + `
			) mvt`
	case "energy-assets":
		query = `
			SELECT ST_AsMVT(mvt.*, $4) FROM (
				SELECT ` + mvtGeom + ` AS geom,
					id::text, name, asset_type, country_code, confidence_score
				FROM assets
				WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND geom IS NOT NULL
				  AND asset_type IN ('tank_farm','terminal','refinery','port','sts_zone','storage','berth')
				  AND ` + tileFilter + `
			) mvt`
	case "pipelines":
		if s.legacyPool == nil || z < pipelineMinZoom {
			w.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")
			w.WriteHeader(http.StatusOK)
			return
		}
		err := s.legacyPool.QueryRow(r.Context(), pipelineMVTQuery, z, x, y, layerName).Scan(&tile)
		if err != nil || len(tile) == 0 {
			w.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")
		w.Header().Set("Cache-Control", "public, max-age=300")
		_, _ = w.Write(tile)
		return
	default:
		query = `
			SELECT ST_AsMVT(mvt.*, $4) FROM (
				SELECT ` + mvtGeom + ` AS geom,
					id::text, name, asset_type, country_code, confidence_score
				FROM ` + table + ` WHERE ` + tileFilter + `
			) mvt`
	}
	err := s.pool.QueryRow(r.Context(), query, z, x, y, layerName).Scan(&tile)
	if err != nil || len(tile) == 0 {
		w.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")
		w.WriteHeader(http.StatusOK)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")
	cache := "public, max-age=300"
	switch layer {
	case "vessels":
		cache = "public, max-age=30"
	case "energy-assets", "metals-assets", "pipelines":
		cache = "public, max-age=120"
	}
	w.Header().Set("Cache-Control", cache)
	_, _ = w.Write(tile)
}
