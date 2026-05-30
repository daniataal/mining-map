package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mining-map/oil-live-intel/internal/overpass"
)

var WorldTiles = map[string][]float64{
	"north_america_west":  {7.0, -170.0, 72.0, -95.0},
	"north_america_east":  {7.0, -95.0, 72.0, -50.0},
	"south_america":       {-56.0, -82.0, 13.0, -34.0},
	"europe":              {34.0, -12.0, 72.0, 40.0},
	"mena":                {12.0, -18.0, 38.0, 64.0},
	"sub_saharan_africa":  {-35.0, -20.0, 18.0, 55.0},
	"russia_central_asia": {36.0, 40.0, 78.0, 110.0},
	"south_asia":          {5.0, 64.0, 36.0, 92.0},
	"east_asia":           {18.0, 92.0, 55.0, 150.0},
	"southeast_asia":      {-12.0, 92.0, 24.0, 141.0},
	"oceania":             {-50.0, 110.0, 5.0, 180.0},
}

func parseEnvInt(key string, def int) int {
	val := os.Getenv(key)
	if val == "" {
		return def
	}
	i, err := strconv.Atoi(val)
	if err != nil {
		return def
	}
	return i
}

func ensurePetroleumOSMTables(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS petroleum_osm_features (
			id BIGSERIAL PRIMARY KEY,
			osm_type TEXT NOT NULL,
			osm_id BIGINT NOT NULL,
			layer_id TEXT NOT NULL,
			tags JSONB,
			geom GEOMETRY(Geometry, 4326),
			fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (osm_type, osm_id, layer_id)
		);
		CREATE INDEX IF NOT EXISTS idx_petroleum_osm_features_layer ON petroleum_osm_features (layer_id);
		CREATE INDEX IF NOT EXISTS idx_petroleum_osm_features_geom ON petroleum_osm_features USING GIST (geom);

		CREATE TABLE IF NOT EXISTS petroleum_osm_sync_runs (
			id SERIAL PRIMARY KEY,
			started_at TIMESTAMPTZ NOT NULL,
			finished_at TIMESTAMPTZ,
			status TEXT NOT NULL,
			layers_processed INTEGER DEFAULT 0,
			features_upserted INTEGER DEFAULT 0,
			errors JSONB,
			note TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_petroleum_osm_sync_runs_started ON petroleum_osm_sync_runs (started_at DESC);
	`)
	return err
}

func startSyncRun(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	var id int
	err := pool.QueryRow(ctx, `INSERT INTO petroleum_osm_sync_runs (started_at, status) VALUES (NOW(), 'running') RETURNING id`).Scan(&id)
	return id, err
}

func finishSyncRun(ctx context.Context, pool *pgxpool.Pool, id int, status string, layers int, features int, errorsList []string) {
	errsJSON, _ := json.Marshal(errorsList)
	if len(errorsList) == 0 {
		errsJSON = []byte("[]")
	}
	_, err := pool.Exec(ctx, `
		UPDATE petroleum_osm_sync_runs
		SET finished_at = NOW(), status = $1, layers_processed = $2, features_upserted = $3, errors = $4::jsonb
		WHERE id = $5
	`, status, layers, features, string(errsJSON), id)
	if err != nil {
		log.Printf("[petroleum-osm-worker] failed to finish sync run %d: %v", id, err)
	}
}

func RunPetroleumOSMSync(ctx context.Context, pool *pgxpool.Pool) {
	enabled := strings.ToLower(strings.TrimSpace(os.Getenv("PETROLEUM_OSM_SYNC_ENABLED")))
	if enabled == "0" || enabled == "false" || enabled == "no" || enabled == "off" {
		log.Println("[petroleum-osm-worker] skipped: PETROLEUM_OSM_SYNC_ENABLED is off")
		return
	}

	interval := time.Duration(parseEnvInt("PETROLEUM_OSM_SYNC_INTERVAL_SECONDS", 86400)) * time.Second
	if interval < time.Hour {
		interval = time.Hour
	}
	backoff := time.Duration(parseEnvInt("PETROLEUM_OSM_SYNC_BACKOFF_SECONDS", 3600)) * time.Second

	if err := ensurePetroleumOSMTables(ctx, pool); err != nil {
		log.Printf("[petroleum-osm-worker] table creation failed: %v", err)
	}

	client := overpass.NewClient()

	for {
		log.Println("[petroleum-osm-worker] starting OSM petroleum tile sync…")
		runID, err := startSyncRun(ctx, pool)
		if err != nil {
			log.Printf("[petroleum-osm-worker] failed to start sync run: %v", err)
			time.Sleep(backoff)
			continue
		}

		layers := []string{"pipelines", "refineries", "storage_terminals"}
		var allErrors []string
		totalFeatures := 0

		for _, layer := range layers {
			log.Printf("[petroleum-osm-worker] syncing layer %s...", layer)
			for tileName, bbox := range WorldTiles {
				query := overpass.BuildQuery(layer, bbox)
				elements, err := client.Fetch(ctx, query)
				if err != nil {
					allErrors = append(allErrors, fmt.Sprintf("%s/%s: %v", layer, tileName, err))
					continue
				}

				written := 0
				for _, el := range elements {
					geomJSON := elementToGeomJSON(layer, el)
					if geomJSON == nil {
						continue
					}
					tagsJSON, _ := json.Marshal(el.Tags)
					if len(el.Tags) == 0 {
						tagsJSON = []byte("{}")
					}

					_, err := pool.Exec(ctx, `
						INSERT INTO petroleum_osm_features (osm_type, osm_id, layer_id, tags, geom, fetched_at)
						VALUES ($1, $2, $3, $4::jsonb, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), NOW())
						ON CONFLICT (osm_type, osm_id, layer_id) DO UPDATE SET
							tags = EXCLUDED.tags,
							geom = EXCLUDED.geom,
							fetched_at = NOW();
					`, el.Type, el.ID, layer, string(tagsJSON), string(geomJSON))
					if err != nil {
						allErrors = append(allErrors, fmt.Sprintf("%s/%s/%d: upsert failed: %v", layer, el.Type, el.ID, err))
					} else {
						written++
					}
				}
				totalFeatures += written
				time.Sleep(2 * time.Second) // rate limit
			}
		}

		status := "success"
		if len(allErrors) > 0 {
			if totalFeatures > 0 {
				status = "partial"
			} else {
				status = "error"
			}
		}

		finishSyncRun(ctx, pool, runID, status, len(layers), totalFeatures, allErrors)
		log.Printf("[petroleum-osm-worker] done: status=%s features=%d errors=%d", status, totalFeatures, len(allErrors))

		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

func elementToGeomJSON(layer string, el overpass.Element) []byte {
	if layer == "pipelines" && el.Type == "way" {
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
		geom := map[string]interface{}{
			"type":        "LineString",
			"coordinates": coords,
		}
		b, _ := json.Marshal(geom)
		return b
	}

	if layer == "refineries" || layer == "storage_terminals" {
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

		geom := map[string]interface{}{
			"type":        "Point",
			"coordinates": []float64{lon, lat},
		}
		b, _ := json.Marshal(geom)
		return b
	}

	return nil
}
