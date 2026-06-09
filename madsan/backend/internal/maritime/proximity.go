package maritime

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var energyTerminalTypes = []string{"terminal", "port", "tank_farm", "berth", "refinery", "storage"}

// LinkVesselProximities creates inferred vessel→asset relationships from AIS destination and position.
func LinkVesselProximities(ctx context.Context, pool *pgxpool.Pool, vesselID uuid.UUID, mmsi, destination string, lat, lng *float64) (int, error) {
	linked := 0
	if destination != "" {
		n, err := linkByDestination(ctx, pool, vesselID, destination)
		if err != nil {
			return linked, err
		}
		linked += n
	}
	if lat != nil && lng != nil {
		n, err := linkByProximity(ctx, pool, vesselID, *lat, *lng)
		if err != nil {
			return linked, err
		}
		linked += n
	}
	_ = mmsi
	return linked, nil
}

func linkByDestination(ctx context.Context, pool *pgxpool.Pool, vesselID uuid.UUID, destination string) (int, error) {
	needle := normalizeDestination(destination)
	if len(needle) < 3 {
		return 0, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT id, name, asset_type
		FROM assets
		WHERE asset_type = ANY($1)
		  AND (name ILIKE '%' || $2 || '%' OR normalized_name ILIKE '%' || lower($2) || '%')
		ORDER BY confidence_score DESC NULLS LAST
		LIMIT 3
	`, energyTerminalTypes, needle)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var assetID uuid.UUID
		var name, assetType string
		if rows.Scan(&assetID, &name, &assetType) != nil {
			continue
		}
		if insertVesselRel(ctx, pool, vesselID, assetID, "destination_match", 50) {
			n++
		}
	}
	return n, nil
}

func linkByProximity(ctx context.Context, pool *pgxpool.Pool, vesselID uuid.UUID, lat, lng float64) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT a.id, a.name, a.asset_type,
		       ST_Distance(a.geom, ST_SetSRID(ST_MakePoint($3,$2),4326)::geography) / 1000 AS km
		FROM assets a
		WHERE a.geom IS NOT NULL
		  AND a.asset_type = ANY($4)
		  AND ST_DWithin(a.geom, ST_SetSRID(ST_MakePoint($3,$2),4326)::geography, 80000)
		ORDER BY km ASC
		LIMIT 2
	`, lat, lng, energyTerminalTypes)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var assetID uuid.UUID
		var name, assetType string
		var km float64
		if rows.Scan(&assetID, &name, &assetType, &km) != nil {
			continue
		}
		conf := 70.0
		if km > 40 {
			conf = 45
		}
		if insertVesselRel(ctx, pool, vesselID, assetID, "near_terminal", conf) {
			n++
		}
	}
	return n, nil
}

func insertVesselRel(ctx context.Context, pool *pgxpool.Pool, vesselID, assetID uuid.UUID, relType string, score float64) bool {
	tag, err := pool.Exec(ctx, `
		INSERT INTO relationships (from_entity_type, from_entity_id, to_entity_type, to_entity_id, relationship_type, confidence_score)
		SELECT 'vessel', $1, 'asset', $2, $3, $4
		WHERE NOT EXISTS (
			SELECT 1 FROM relationships
			WHERE from_entity_type = 'vessel' AND from_entity_id = $1
			  AND to_entity_type = 'asset' AND to_entity_id = $2
			  AND relationship_type = $3
		)
	`, vesselID, assetID, relType, score)
	return err == nil && tag.RowsAffected() > 0
}

func normalizeDestination(dest string) string {
	dest = strings.TrimSpace(dest)
	if dest == "" {
		return ""
	}
	dest = strings.Trim(dest, "> ")
	parts := strings.Fields(dest)
	if len(parts) == 0 {
		return dest
	}
	// AIS often reports "FOR ORDERS", "SG SIN", port names — use longest alpha token.
	best := parts[len(parts)-1]
	for _, p := range parts {
		clean := strings.Trim(p, ",.")
		if len(clean) > len(best) && strings.ContainsAny(clean, "aeiouAEIOU") {
			best = clean
		}
	}
	return best
}

// BackfillVesselLinks links vessels with destinations or recent positions to nearby terminals.
func BackfillVesselLinks(ctx context.Context, pool *pgxpool.Pool, limit int) (int, error) {
	if limit <= 0 {
		limit = 3000
	}
	rows, err := pool.Query(ctx, `
		SELECT id, COALESCE(mmsi,''), COALESCE(destination,''), latitude, longitude
		FROM vessels
		WHERE (destination <> '' OR (latitude IS NOT NULL AND longitude IS NOT NULL))
		  AND last_seen_at > now() - interval '14 days'
		ORDER BY last_seen_at DESC NULLS LAST
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	total := 0
	for rows.Next() {
		var id uuid.UUID
		var mmsi, dest string
		var lat, lng *float64
		if rows.Scan(&id, &mmsi, &dest, &lat, &lng) != nil {
			continue
		}
		n, _ := LinkVesselProximities(ctx, pool, id, mmsi, dest, lat, lng)
		total += n
	}
	return total, nil
}
