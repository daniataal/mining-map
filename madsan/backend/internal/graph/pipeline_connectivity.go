package graph

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	EndpointToleranceM = 30
	AssetSnapRadiusM   = 500
	maxNeighbors       = 25
)

var ErrPipelineNotFound = errors.New("pipeline not found")

type GeoPoint struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type SnappedAsset struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	AssetType       string  `json:"asset_type"`
	DistanceM       float64 `json:"distance_m"`
	ConfidenceScore float64 `json:"confidence_score"`
	Tier            string  `json:"tier"`
}

type EndpointInfo struct {
	Point        GeoPoint      `json:"point"`
	SnappedAsset *SnappedAsset `json:"snapped_asset,omitempty"`
}

type PipelineNeighbor struct {
	EdgeID            string  `json:"edge_id"`
	OSMID             string  `json:"osm_id,omitempty"`
	Name              string  `json:"name,omitempty"`
	ConnectionPoint   string  `json:"connection_point"`
	DistanceM         float64 `json:"distance_m"`
	PipelineSubstance string  `json:"pipeline_substance,omitempty"`
}

type PipelineConnectivity struct {
	PipelineID  string             `json:"pipeline_id"`
	OSMID       string             `json:"osm_id,omitempty"`
	LegacyID    string             `json:"legacy_id,omitempty"`
	Name        string             `json:"name,omitempty"`
	Tier        string             `json:"tier"`
	Method      string             `json:"method"`
	Endpoints   Endpoints          `json:"endpoints"`
	Upstream    []PipelineNeighbor `json:"upstream"`
	Downstream  []PipelineNeighbor `json:"downstream"`
	Limitations []string           `json:"limitations"`
}

type Endpoints struct {
	Start EndpointInfo `json:"start"`
	End   EndpointInfo `json:"end"`
}

type pipelineRow struct {
	ID       uuid.UUID
	OSMID    *string
	Metadata []byte
	StartLat float64
	StartLng float64
	EndLat   float64
	EndLng   float64
}

func LoadPipelineConnectivity(ctx context.Context, pool *pgxpool.Pool, idParam string) (*PipelineConnectivity, error) {
	row, err := resolvePipeline(ctx, pool, idParam)
	if err != nil {
		return nil, err
	}

	name, legacyID, _ := parsePipelineMeta(row.Metadata)
	startSnap, err := snapNearestAsset(ctx, pool, row.StartLat, row.StartLng)
	if err != nil {
		return nil, fmt.Errorf("snap start asset: %w", err)
	}
	endSnap, err := snapNearestAsset(ctx, pool, row.EndLat, row.EndLng)
	if err != nil {
		return nil, fmt.Errorf("snap end asset: %w", err)
	}

	upstream, err := neighborsAtPoint(ctx, pool, row.ID, row.StartLat, row.StartLng)
	if err != nil {
		return nil, fmt.Errorf("upstream neighbors: %w", err)
	}
	downstream, err := neighborsAtPoint(ctx, pool, row.ID, row.EndLat, row.EndLng)
	if err != nil {
		return nil, fmt.Errorf("downstream neighbors: %w", err)
	}

	osmID := ""
	if row.OSMID != nil {
		osmID = *row.OSMID
	}

	return &PipelineConnectivity{
		PipelineID: row.ID.String(),
		OSMID:      osmID,
		LegacyID:   legacyID,
		Name:       name,
		Tier:       "inferred",
		Method:     "endpoint_proximity",
		Endpoints: Endpoints{
			Start: EndpointInfo{
				Point:        GeoPoint{Latitude: row.StartLat, Longitude: row.StartLng},
				SnappedAsset: startSnap,
			},
			End: EndpointInfo{
				Point:        GeoPoint{Latitude: row.EndLat, Longitude: row.EndLng},
				SnappedAsset: endSnap,
			},
		},
		Upstream:   upstream,
		Downstream: downstream,
		Limitations: []string{
			"Connectivity inferred from geometry endpoint proximity (" + fmt.Sprint(EndpointToleranceM) + "m); flow direction not verified unless OSM tags specify it",
			fmt.Sprintf("Endpoint asset snaps are nearest-neighbor within %dm — inferred tier, not confirmed pipeline connections", AssetSnapRadiusM),
			"pgRouting topology not yet applied; neighbor list may be incomplete at complex junctions",
		},
	}, nil
}

func resolvePipeline(ctx context.Context, pool *pgxpool.Pool, idParam string) (*pipelineRow, error) {
	idParam = strings.TrimSpace(idParam)
	if idParam == "" {
		return nil, ErrPipelineNotFound
	}

	lookupKeys := []string{idParam}
	if uid, err := uuid.Parse(idParam); err == nil {
		lookupKeys = append(lookupKeys, uid.String())
	}
	if !strings.HasPrefix(idParam, "legacy:") {
		lookupKeys = append(lookupKeys, "legacy:"+idParam)
	}

	const q = `
		SELECT id, osm_id, metadata,
		       ST_Y(ST_StartPoint(geom::geometry)) AS start_lat,
		       ST_X(ST_StartPoint(geom::geometry)) AS start_lng,
		       ST_Y(ST_EndPoint(geom::geometry)) AS end_lat,
		       ST_X(ST_EndPoint(geom::geometry)) AS end_lng
		FROM pipeline_graph_edges
		WHERE id::text = ANY($1)
		   OR osm_id = ANY($1)
		   OR metadata->>'legacy_id' = ANY($1)
		LIMIT 1`

	var row pipelineRow
	err := pool.QueryRow(ctx, q, lookupKeys).Scan(
		&row.ID, &row.OSMID, &row.Metadata,
		&row.StartLat, &row.StartLng, &row.EndLat, &row.EndLng,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPipelineNotFound
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func parsePipelineMeta(raw []byte) (name, legacyID, substance string) {
	if len(raw) == 0 {
		return "", "", ""
	}
	var meta map[string]any
	if err := json.Unmarshal(raw, &meta); err != nil {
		return "", "", ""
	}
	if v, ok := meta["legacy_id"].(string); ok {
		legacyID = v
	}
	if tags, ok := meta["tags"].(map[string]any); ok {
		if n, ok := tags["name"].(string); ok && n != "" {
			name = n
		}
		if s, ok := tags["substance"].(string); ok {
			substance = s
		}
	}
	if name == "" {
		if n, ok := meta["name"].(string); ok {
			name = n
		}
	}
	return name, legacyID, substance
}

func snapNearestAsset(ctx context.Context, pool *pgxpool.Pool, lat, lng float64) (*SnappedAsset, error) {
	const q = `
		SELECT id, name, asset_type,
		       ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m,
		       COALESCE(confidence_score, 0)
		FROM assets
		WHERE geom IS NOT NULL
		  AND asset_type <> 'pipeline'
		  AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
		ORDER BY distance_m ASC
		LIMIT 1`

	var id uuid.UUID
	var name, assetType string
	var distM, conf float64
	err := pool.QueryRow(ctx, q, lng, lat, AssetSnapRadiusM).Scan(&id, &name, &assetType, &distM, &conf)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &SnappedAsset{
		ID: id.String(), Name: name, AssetType: assetType,
		DistanceM: distM, ConfidenceScore: conf, Tier: "inferred",
	}, nil
}

func neighborsAtPoint(ctx context.Context, pool *pgxpool.Pool, excludeID uuid.UUID, lat, lng float64) ([]PipelineNeighbor, error) {
	const q = `
		SELECT e.id, COALESCE(e.osm_id, ''),
		       COALESCE(NULLIF(e.metadata->'tags'->>'name', ''), NULLIF(e.metadata->>'name', ''), ''),
		       LEAST(
		         ST_Distance(ST_StartPoint(e.geom::geometry)::geography, pt),
		         ST_Distance(ST_EndPoint(e.geom::geometry)::geography, pt)
		       ) AS distance_m,
		       CASE
		         WHEN ST_DWithin(ST_StartPoint(e.geom::geometry)::geography, pt, $4) THEN 'start'
		         ELSE 'end'
		       END AS connection_point,
		       COALESCE(e.metadata->'tags'->>'substance', '')
		FROM pipeline_graph_edges e,
		     ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS pt
		WHERE e.id <> $3
		  AND e.geom IS NOT NULL
		  AND (
		    ST_DWithin(ST_StartPoint(e.geom::geometry)::geography, pt, $4)
		    OR ST_DWithin(ST_EndPoint(e.geom::geometry)::geography, pt, $4)
		  )
		ORDER BY distance_m ASC
		LIMIT $5`

	rows, err := pool.Query(ctx, q, lng, lat, excludeID, EndpointToleranceM, maxNeighbors)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PipelineNeighbor
	for rows.Next() {
		var n PipelineNeighbor
		var edgeID uuid.UUID
		if err := rows.Scan(&edgeID, &n.OSMID, &n.Name, &n.DistanceM, &n.ConnectionPoint, &n.PipelineSubstance); err != nil {
			return nil, err
		}
		n.EdgeID = edgeID.String()
		out = append(out, n)
	}
	if out == nil {
		out = []PipelineNeighbor{}
	}
	return out, rows.Err()
}
