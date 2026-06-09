package api

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func loadRelationships(ctx context.Context, pool *pgxpool.Pool, entityType string, entityID uuid.UUID) []RelationshipEdge {
	var edges []RelationshipEdge
	edges = append(edges, loadTableRelationships(ctx, pool, entityType, entityID)...)
	switch entityType {
	case "asset":
		edges = append(edges, loadAssetFKRelationships(ctx, pool, entityID)...)
	case "company":
		edges = append(edges, loadCompanyAssetRelationships(ctx, pool, entityID)...)
	case "vessel":
		edges = append(edges, loadVesselAssetRelationships(ctx, pool, entityID)...)
	}
	edges = enrichRelationshipCoords(ctx, pool, edges)
	return dedupeRelationshipEdges(edges)
}

func loadTableRelationships(ctx context.Context, pool *pgxpool.Pool, entityType string, entityID uuid.UUID) []RelationshipEdge {
	rows, err := pool.Query(ctx, `
		SELECT relationship_type, to_entity_type, to_entity_id, confidence_score
		FROM relationships
		WHERE from_entity_type = $1 AND from_entity_id = $2
		UNION ALL
		SELECT relationship_type, from_entity_type, from_entity_id, confidence_score
		FROM relationships
		WHERE to_entity_type = $1 AND to_entity_id = $2
		LIMIT 30
	`, entityType, entityID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []RelationshipEdge
	for rows.Next() {
		var relType, otherType string
		var otherID uuid.UUID
		var conf float64
		if rows.Scan(&relType, &otherType, &otherID, &conf) != nil {
			continue
		}
		name := resolveEntityName(ctx, pool, otherType, otherID)
		if name == "" {
			continue
		}
		out = append(out, RelationshipEdge{
			ID: otherID.String(), Type: relType, EntityType: otherType, Name: name,
			Direction: "linked", ConfidenceScore: conf,
		})
	}
	return out
}

func loadAssetFKRelationships(ctx context.Context, pool *pgxpool.Pool, assetID uuid.UUID) []RelationshipEdge {
	rows, err := pool.Query(ctx, `
		SELECT 'operated_by', c.id, c.name, a.confidence_score, NULL::float8, NULL::float8
		FROM assets a JOIN companies c ON c.id = a.operator_company_id
		WHERE a.id = $1 AND a.operator_company_id IS NOT NULL
		UNION ALL
		SELECT 'owned_by', c.id, c.name, a.confidence_score, NULL::float8, NULL::float8
		FROM assets a JOIN companies c ON c.id = a.owner_company_id
		WHERE a.id = $1 AND a.owner_company_id IS NOT NULL
	`, assetID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	return scanRelationshipRows(rows)
}

func loadCompanyAssetRelationships(ctx context.Context, pool *pgxpool.Pool, companyID uuid.UUID) []RelationshipEdge {
	rows, err := pool.Query(ctx, `
		SELECT 'operates', a.id, a.name, a.confidence_score, a.latitude, a.longitude
		FROM assets a WHERE a.operator_company_id = $1 AND a.latitude IS NOT NULL
		UNION ALL
		SELECT 'owns', a.id, a.name, a.confidence_score, a.latitude, a.longitude
		FROM assets a WHERE a.owner_company_id = $1 AND a.latitude IS NOT NULL
		ORDER BY confidence_score DESC NULLS LAST
		LIMIT 20
	`, companyID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	return scanRelationshipRows(rows)
}

func scanRelationshipRows(rows interface {
	Next() bool
	Scan(dest ...any) error
}) []RelationshipEdge {
	var out []RelationshipEdge
	for rows.Next() {
		var relType, name string
		var otherID uuid.UUID
		var conf float64
		var lat, lng *float64
		if rows.Scan(&relType, &otherID, &name, &conf, &lat, &lng) != nil {
			continue
		}
		entityType := "asset"
		if relType == "operated_by" || relType == "owned_by" {
			entityType = "company"
		}
		if relType == "operates" || relType == "owns" {
			entityType = "asset"
		}
		out = append(out, RelationshipEdge{
			ID: otherID.String(), Type: relType, EntityType: entityType, Name: name,
			Direction: "outbound", ConfidenceScore: conf, Latitude: lat, Longitude: lng,
		})
	}
	return out
}

func enrichRelationshipCoords(ctx context.Context, pool *pgxpool.Pool, edges []RelationshipEdge) []RelationshipEdge {
	out := make([]RelationshipEdge, len(edges))
	for i, e := range edges {
		out[i] = e
		if e.Latitude != nil && e.Longitude != nil {
			continue
		}
		uid, err := uuid.Parse(e.ID)
		if err != nil {
			continue
		}
		lat, lng := resolveEntityCoords(ctx, pool, e.EntityType, uid)
		out[i].Latitude = lat
		out[i].Longitude = lng
	}
	return out
}

func resolveEntityName(ctx context.Context, pool *pgxpool.Pool, entityType string, id uuid.UUID) string {
	var name string
	var q string
	switch entityType {
	case "company":
		q = `SELECT name FROM companies WHERE id = $1`
	case "asset":
		q = `SELECT name FROM assets WHERE id = $1`
	case "vessel":
		q = `SELECT name FROM vessels WHERE id = $1`
	default:
		return ""
	}
	if pool.QueryRow(ctx, q, id).Scan(&name) != nil {
		return ""
	}
	return name
}

func resolveEntityCoords(ctx context.Context, pool *pgxpool.Pool, entityType string, id uuid.UUID) (*float64, *float64) {
	var lat, lng *float64
	switch entityType {
	case "asset":
		_ = pool.QueryRow(ctx, `SELECT latitude, longitude FROM assets WHERE id = $1`, id).Scan(&lat, &lng)
	case "vessel":
		_ = pool.QueryRow(ctx, `SELECT latitude, longitude FROM vessels WHERE id = $1`, id).Scan(&lat, &lng)
	case "company":
		_ = pool.QueryRow(ctx, `
			SELECT AVG(latitude), AVG(longitude) FROM assets
			WHERE operator_company_id = $1 AND latitude IS NOT NULL
		`, id).Scan(&lat, &lng)
	}
	return lat, lng
}

func loadVesselAssetRelationships(ctx context.Context, pool *pgxpool.Pool, vesselID uuid.UUID) []RelationshipEdge {
	rows, err := pool.Query(ctx, `
		SELECT r.relationship_type, a.id, a.name, r.confidence_score, a.latitude, a.longitude
		FROM relationships r
		JOIN assets a ON a.id = r.to_entity_id
		WHERE r.from_entity_type = 'vessel' AND r.from_entity_id = $1
		  AND r.to_entity_type = 'asset'
		ORDER BY r.confidence_score DESC NULLS LAST
		LIMIT 8
	`, vesselID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []RelationshipEdge
	for rows.Next() {
		var relType, name string
		var assetID uuid.UUID
		var conf float64
		var lat, lng *float64
		if rows.Scan(&relType, &assetID, &name, &conf, &lat, &lng) != nil {
			continue
		}
		out = append(out, RelationshipEdge{
			ID: assetID.String(), Type: relType, EntityType: "asset", Name: name,
			Direction: "outbound", ConfidenceScore: conf, Latitude: lat, Longitude: lng,
		})
	}
	return out
}

func companyCentroid(ctx context.Context, pool *pgxpool.Pool, companyID uuid.UUID) map[string]any {
	var lat, lng *float64
	_ = pool.QueryRow(ctx, `
		SELECT AVG(latitude), AVG(longitude) FROM assets
		WHERE operator_company_id = $1 AND latitude IS NOT NULL
	`, companyID).Scan(&lat, &lng)
	if lat == nil || lng == nil {
		return nil
	}
	return map[string]any{"latitude": *lat, "longitude": *lng}
}

func dedupeRelationshipEdges(in []RelationshipEdge) []RelationshipEdge {
	seen := map[string]bool{}
	var out []RelationshipEdge
	for _, e := range in {
		key := fmt.Sprintf("%s:%s:%s", e.Type, e.EntityType, e.ID)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, e)
	}
	return out
}
