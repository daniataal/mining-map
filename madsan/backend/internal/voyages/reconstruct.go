package voyages

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RebuildResult summarizes voyage leg reconstruction.
type RebuildResult struct {
	Paired     int `json:"paired"`
	Tracks     int `json:"tracks_built"`
	FromLive   int `json:"from_live_visits"`
	FromLegacy int `json:"from_legacy_port_calls"`
}

// Rebuild pairs load/discharge port calls into voyages with PostGIS track linestrings.
func Rebuild(ctx context.Context, primary, legacy *pgxpool.Pool) (RebuildResult, error) {
	var res RebuildResult
	if primary != nil {
		n, err := rebuildFromVisits(ctx, primary)
		if err != nil {
			return res, err
		}
		res.FromLive = n
		res.Paired += n
	}
	if legacy != nil && res.Paired < 50 {
		n, err := rebuildFromLegacyPortCalls(ctx, primary, legacy)
		if err != nil {
			return res, err
		}
		res.FromLegacy = n
		res.Paired += n
	}
	if primary != nil {
		tracks, err := buildTrackGeometries(ctx, primary)
		if err != nil {
			return res, err
		}
		res.Tracks = tracks
	}
	return res, nil
}

func rebuildFromVisits(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT e.id, e.mmsi, e.vessel_id, e.arrival_ts, COALESCE(e.departure_ts, e.arrival_ts),
			e.asset_id, ae.name, COALESCE(ae.country_code,''),
			ST_Y(ae.geom::geometry), ST_X(ae.geom::geometry),
			i.id, i.arrival_ts, COALESCE(i.departure_ts, i.arrival_ts),
			ai.name, COALESCE(ai.country_code,''),
			ST_Y(ai.geom::geometry), ST_X(ai.geom::geometry),
			COALESCE(e.commodity_family, '')
		FROM port_call_visits e
		JOIN assets ae ON ae.id = e.asset_id
		JOIN port_call_visits i ON i.mmsi = e.mmsi
			AND i.status = 'closed' AND i.event_type = 'possible_unloading'
			AND i.arrival_ts > COALESCE(e.departure_ts, e.arrival_ts)
			AND i.arrival_ts < COALESCE(e.departure_ts, e.arrival_ts) + interval '60 days'
		JOIN assets ai ON ai.id = i.asset_id
		WHERE e.status = 'closed' AND e.event_type = 'possible_loading'
		  AND e.arrival_ts > now() - interval '365 days'
		ORDER BY e.arrival_ts DESC
		LIMIT 2000
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	paired := 0
	for rows.Next() {
		var loadID, dischargeID, loadAsset uuid.UUID
		var mmsi string
		var vesselID *uuid.UUID
		var loadStart, loadEnd, dischargeStart, dischargeEnd interface{}
		var loadName, loadCountry, dischargeName, dischargeCountry, family string
		var llat, llon, dlat, dlon float64
		if err := rows.Scan(
			&loadID, &mmsi, &vesselID, &loadStart, &loadEnd, &loadAsset, &loadName, &loadCountry, &llat, &llon,
			&dischargeID, &dischargeStart, &dischargeEnd, &dischargeName, &dischargeCountry, &dlat, &dlon, &family,
		); err != nil {
			return paired, err
		}
		meta, _ := json.Marshal(map[string]any{
			"load_visit_id":      loadID.String(),
			"discharge_visit_id": dischargeID.String(),
			"source":             "live_ais",
		})
		vid := uuid.Nil
		if vesselID != nil {
			vid = *vesselID
		}
		tag, err := pool.Exec(ctx, `
			INSERT INTO voyages (
				vessel_id, mmsi, load_port_name, load_country, discharge_port_name, discharge_country,
				commodity_family, started_at, ended_at, confidence_score, tier, metadata, geom
			)
			SELECT
				NULLIF($1::uuid, '00000000-0000-0000-0000-000000000000'), $2, $3, $4, $5, $6, NULLIF($7,''),
				$8, $9, 65, 'observed', $10,
				ST_SetSRID(ST_MakeLine(ST_MakePoint($11, $12), ST_MakePoint($13, $14)), 4326)::geography
			WHERE NOT EXISTS (
				SELECT 1 FROM voyages
				WHERE mmsi = $2
				  AND metadata->>'load_visit_id' = $14
				  AND metadata->>'discharge_visit_id' = $15
			)
		`, vid, mmsi, loadName, loadCountry, dischargeName, dischargeCountry, family,
			loadStart, dischargeEnd, meta, llon, llat, dlon, dlat, loadID.String(), dischargeID.String())
		if err != nil {
			return paired, err
		}
		if tag.RowsAffected() > 0 {
			paired++
		}
	}
	return paired, rows.Err()
}

func rebuildFromLegacyPortCalls(ctx context.Context, primary, legacy *pgxpool.Pool) (int, error) {
	rows, err := legacy.Query(ctx, `
		SELECT e.id, e.mmsi::text, e.arrival_ts, COALESCE(e.departure_ts, e.arrival_ts),
			te.name, COALESCE(te.country,''), ST_Y(te.geom::geometry), ST_X(te.geom::geometry),
			i.id, COALESCE(i.departure_ts, i.arrival_ts),
			ti.name, COALESCE(ti.country,''), ST_Y(ti.geom::geometry), ST_X(ti.geom::geometry)
		FROM oil_port_calls e
		JOIN oil_terminals te ON te.id = e.terminal_id
		JOIN oil_port_calls i ON i.mmsi = e.mmsi
			AND i.status = 'closed' AND i.event_type = 'possible_unloading'
			AND i.arrival_ts > COALESCE(e.departure_ts, e.arrival_ts)
			AND i.arrival_ts < COALESCE(e.departure_ts, e.arrival_ts) + interval '60 days'
		JOIN oil_terminals ti ON ti.id = i.terminal_id
		WHERE e.status = 'closed' AND e.event_type = 'possible_loading'
		  AND e.arrival_ts > now() - interval '365 days'
		ORDER BY e.arrival_ts DESC LIMIT 3000
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	if primary == nil {
		return 0, nil
	}

	paired := 0
	for rows.Next() {
		var loadLegacyID, dischargeLegacyID uuid.UUID
		var mmsi, loadName, loadCountry, dischargeName, dischargeCountry string
		var loadStart, loadEnd, dischargeEnd interface{}
		var llat, llon, dlat, dlon float64
		if err := rows.Scan(
			&loadLegacyID, &mmsi, &loadStart, &loadEnd, &loadName, &loadCountry, &llat, &llon,
			&dischargeLegacyID, &dischargeEnd, &dischargeName, &dischargeCountry, &dlat, &dlon,
		); err != nil {
			return paired, err
		}
		var vesselID uuid.UUID
		_ = primary.QueryRow(ctx, `SELECT id FROM vessels WHERE mmsi = $1`, mmsi).Scan(&vesselID)
		meta, _ := json.Marshal(map[string]any{
			"legacy_port_call_id":        loadLegacyID.String(),
			"legacy_discharge_port_call": dischargeLegacyID.String(),
			"source":                     "legacy_oil_port_calls",
		})
		tag, err := primary.Exec(ctx, `
			INSERT INTO voyages (
				vessel_id, mmsi, load_port_name, load_country, discharge_port_name, discharge_country,
				started_at, ended_at, confidence_score, tier, metadata, geom
			)
			SELECT
				NULLIF($1::uuid, '00000000-0000-0000-0000-000000000000'), $2, $3, $4, $5, $6,
				$7, $8, 55, 'observed', $9,
				ST_SetSRID(ST_MakeLine(ST_MakePoint($10, $11), ST_MakePoint($12, $13)), 4326)::geography
			WHERE NOT EXISTS (
				SELECT 1 FROM voyages WHERE metadata->>'legacy_port_call_id' = $14
			)
		`, vesselID, mmsi, loadName, loadCountry, dischargeName, dischargeCountry,
			loadStart, dischargeEnd, meta, llon, llat, dlon, dlat, loadLegacyID.String())
		if err != nil {
			return paired, err
		}
		if tag.RowsAffected() > 0 {
			paired++
		}
	}
	return paired, rows.Err()
}

func buildTrackGeometries(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, mmsi, started_at, ended_at
		FROM voyages
		WHERE geom IS NULL AND mmsi IS NOT NULL AND started_at IS NOT NULL AND ended_at IS NOT NULL
		LIMIT 500
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	updated := 0
	for rows.Next() {
		var id uuid.UUID
		var mmsi string
		var start, end interface{}
		if rows.Scan(&id, &mmsi, &start, &end) != nil {
			continue
		}
		tag, err := pool.Exec(ctx, `
			UPDATE voyages v SET geom = sub.track::geography
			FROM (
				SELECT ST_MakeLine(ST_Collect(geom::geometry ORDER BY ts)) AS track
				FROM ais_positions
				WHERE mmsi = $1 AND ts >= $2::timestamptz AND ts <= $3::timestamptz AND geom IS NOT NULL
				HAVING COUNT(*) >= 2
			) sub
			WHERE v.id = $4 AND sub.track IS NOT NULL
		`, mmsi, start, end, id)
		if err != nil {
			continue
		}
		if tag.RowsAffected() > 0 {
			updated++
		}
	}
	return updated, rows.Err()
}

// TrackGeoJSON returns voyage tracks for a vessel as a FeatureCollection.
func TrackGeoJSON(ctx context.Context, pool *pgxpool.Pool, vesselID uuid.UUID, limit int) (map[string]any, error) {
	if limit <= 0 || limit > 20 {
		limit = 10
	}
	rows, err := pool.Query(ctx, `
		SELECT id, load_port_name, discharge_port_name, started_at, ended_at,
			ST_AsGeoJSON(geom::geometry)::jsonb AS geom,
			confidence_score, commodity_family
		FROM voyages
		WHERE vessel_id = $1 AND geom IS NOT NULL
		ORDER BY started_at DESC NULLS LAST
		LIMIT $2
	`, vesselID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	features := make([]any, 0)
	for rows.Next() {
		var id uuid.UUID
		var loadPort, dischargePort, family *string
		var started, ended interface{}
		var geom []byte
		var conf float64
		if rows.Scan(&id, &loadPort, &dischargePort, &started, &ended, &geom, &conf, &family) != nil {
			continue
		}
		var geometry any
		_ = json.Unmarshal(geom, &geometry)
		features = append(features, map[string]any{
			"type": "Feature",
			"id":   id.String(),
			"properties": map[string]any{
				"voyage_id":           id.String(),
				"load_port_name":      loadPort,
				"discharge_port_name": dischargePort,
				"started_at":          started,
				"ended_at":            ended,
				"confidence_score":    conf,
				"commodity_family":    family,
				"tier":                "observed",
				"disclaimer":          "AIS-inferred voyage leg — not a confirmed cargo movement",
			},
			"geometry": geometry,
		})
	}
	return map[string]any{
		"type":       "FeatureCollection",
		"features":   features,
		"count":      len(features),
		"disclaimer": "Voyage tracks from port-call pairing and AIS positions where available",
	}, nil
}

// TrackGeoJSONByMMSI resolves vessel id then returns tracks.
func TrackGeoJSONByMMSI(ctx context.Context, pool *pgxpool.Pool, mmsi string, limit int) (map[string]any, error) {
	var vesselID uuid.UUID
	err := pool.QueryRow(ctx, `SELECT id FROM vessels WHERE mmsi = $1`, mmsi).Scan(&vesselID)
	if err != nil {
		return map[string]any{
			"type": "FeatureCollection", "features": []any{},
			"disclaimer": fmt.Sprintf("No vessel row for MMSI %s", mmsi),
		}, nil
	}
	return TrackGeoJSON(ctx, pool, vesselID, limit)
}
