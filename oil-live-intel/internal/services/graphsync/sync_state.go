package graphsync

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RecordSyncStep persists a graph-sync step result in oil_live_sync_state for sync-status observability.
func RecordSyncStep(ctx context.Context, pool *pgxpool.Pool, key string, step map[string]any) error {
	payload, err := json.Marshal(step)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO oil_live_sync_state (key, value, metadata, updated_at)
		VALUES ($1, now(), $2::jsonb, now())
		ON CONFLICT (key) DO UPDATE SET
		  value = now(),
		  metadata = EXCLUDED.metadata,
		  updated_at = now()
	`, key, payload)
	return err
}
