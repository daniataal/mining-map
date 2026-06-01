package graphsync

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TableExists mirrors backend/services/oil_live_graph_sync._table_exists.
func TableExists(ctx context.Context, pool *pgxpool.Pool, tableName string) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = $1
		)
	`, tableName).Scan(&exists)
	return exists, err
}
