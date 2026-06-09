package workers

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// RunAlertEngineLoop periodically checks watchlists against live conditions to trigger alerts.
func RunAlertEngineLoop(ctx context.Context, pool *pgxpool.Pool, log zerolog.Logger) {
	interval := 1 * time.Hour
	for {
		if err := runAlertEngineOnce(ctx, pool, log); err != nil {
			log.Warn().Err(err).Msg("[alert-engine] pass failed")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

func runAlertEngineOnce(ctx context.Context, pool *pgxpool.Pool, log zerolog.Logger) error {
	// Rule 1: Watchlist vessels that have stopped pinging for > 48 hours.
	query := `
		INSERT INTO oil_alerts (watchlist_id, user_id, alert_type, ref_type, ref_id, title, body, severity)
		SELECT 
			w.id, 
			w.user_id, 
			'vessel_signal_lost', 
			'vessel', 
			v.imo, 
			'Vessel Signal Lost: ' || COALESCE(v.name, v.imo),
			'Vessel has not updated AIS position in over 48 hours. Last seen: ' || v.updated_at,
			'high'
		FROM oil_watchlists w
		JOIN oil_vessels v ON w.watch_ref = v.imo
		WHERE w.watch_type = 'vessel'
		  AND v.updated_at < now() - interval '48 hours'
		ON CONFLICT (watchlist_id, ref_type, ref_id) DO NOTHING
	`

	res, err := pool.Exec(ctx, query)
	if err != nil {
		return err
	}

	if res.RowsAffected() > 0 {
		log.Info().Int64("alerts_created", res.RowsAffected()).Msg("[alert-engine] created signal lost alerts")
	}

	// Rule 2: (Placeholder) Geofence boundary crossing could be added here
	// using PostGIS ST_Intersects(w.polygon, live.geom).

	return nil
}
