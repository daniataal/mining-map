package ais

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PersistVessel upserts oil_vessels from an AIS update.
func PersistVessel(ctx context.Context, pool *pgxpool.Pool, u *Update, tankerClass string) error {
	crude := tankerClass == "crude"
	product := tankerClass == "product" || tankerClass == "chemical"
	meta, _ := json.Marshal(map[string]any{"ship_type_code": u.ShipTypeCode, "ship_type_label": u.ShipTypeLabel})
	_, err := pool.Exec(ctx, `
		INSERT INTO oil_vessels (mmsi, imo, name, callsign, vessel_type, tanker_class, crude_capable, product_tanker, metadata, updated_at)
		VALUES ($1,$2,$3,$4,'Tanker',$5,$6,$7,$8,now())
		ON CONFLICT (mmsi) DO UPDATE SET
			imo=COALESCE(EXCLUDED.imo, oil_vessels.imo),
			name=COALESCE(NULLIF(EXCLUDED.name,''), oil_vessels.name),
			callsign=COALESCE(EXCLUDED.callsign, oil_vessels.callsign),
			tanker_class=EXCLUDED.tanker_class,
			crude_capable=EXCLUDED.crude_capable,
			product_tanker=EXCLUDED.product_tanker,
			metadata=EXCLUDED.metadata,
			updated_at=now()
	`, u.MMSI, nullStr(u.IMO), u.Name, u.Callsign, tankerClass, crude, product, meta)
	return err
}

// PersistPosition inserts AIS position if throttle elapsed.
func PersistPosition(ctx context.Context, pool *pgxpool.Pool, u *Update, minInterval time.Duration) (bool, error) {
	var lastTS time.Time
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(ts), '1970-01-01'::timestamptz) FROM oil_ais_positions WHERE mmsi=$1
	`, u.MMSI).Scan(&lastTS)
	if err != nil {
		return false, err
	}
	if time.Since(lastTS) < minInterval {
		return false, nil
	}
	raw, _ := json.Marshal(u.Raw)
	_, err = pool.Exec(ctx, `
		INSERT INTO oil_ais_positions (mmsi, ts, lat, lon, speed, course, heading, nav_status, draft_m, destination, eta, geom, raw)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, ST_SetSRID(ST_MakePoint($12,$13),4326), $14)
	`, u.MMSI, u.Timestamp, u.Lat, u.Lon, u.Speed, u.Course, u.Heading, u.NavStatus,
		nullableDraft(u.HasDraft, u.DraftM), u.Destination, u.ETA, u.Lon, u.Lat, raw)
	return err == nil, err
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullableDraft(ok bool, v float64) any {
	if !ok {
		return nil
	}
	return v
}

// UpdateSourceHealth updates maritime_source_health for the AIS provider.
func UpdateSourceHealth(ctx context.Context, pool *pgxpool.Pool, observationCount int, lastError error) error {
	status := "ok"
	limitations := []string{}
	if lastError != nil {
		status = "error"
		limitations = append(limitations, lastError.Error())
	}
	
	_, err := pool.Exec(ctx, `
		INSERT INTO maritime_source_health (
			source, source_type, display_name, status, coverage_tier,
			last_observation_at, observation_count, limitations, updated_at
		) VALUES (
			'aisstream', 'ais', 'AISStream Community', $1, 'open_partial',
			CASE WHEN $2 > 0 THEN now() ELSE NULL END, $2, $3, now()
		)
		ON CONFLICT (source) DO UPDATE SET
			status = EXCLUDED.status,
			last_observation_at = COALESCE(EXCLUDED.last_observation_at, maritime_source_health.last_observation_at),
			observation_count = maritime_source_health.observation_count + EXCLUDED.observation_count,
			limitations = EXCLUDED.limitations,
			updated_at = EXCLUDED.updated_at
	`, status, observationCount, limitations)
	return err
}
