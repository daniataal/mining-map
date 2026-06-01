package api

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// GraphSyncStepOutcome is one graph-sync step persisted in oil_live_sync_state.
type GraphSyncStepOutcome struct {
	Key            string         `json:"key"`
	Status         string         `json:"status"`
	Implementation string         `json:"implementation,omitempty"`
	UpdatedAt      string         `json:"updated_at,omitempty"`
	Detail         map[string]any `json:"detail,omitempty"`
}

func queryGraphSyncSteps(ctx context.Context, pool *pgxpool.Pool) []GraphSyncStepOutcome {
	if pool == nil {
		return nil
	}
	rows, err := pool.Query(ctx, `
		SELECT key, metadata, updated_at
		FROM oil_live_sync_state
		WHERE key LIKE 'graphsync_%' OR key LIKE 'graph_sync_step_%'
		ORDER BY key
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := []GraphSyncStepOutcome{}
	for rows.Next() {
		var key string
		var meta []byte
		var updatedAt time.Time
		if err := rows.Scan(&key, &meta, &updatedAt); err != nil {
			continue
		}
		step := GraphSyncStepOutcome{
			Key:       key,
			Status:    "unknown",
			UpdatedAt: updatedAt.UTC().Format(time.RFC3339),
			Detail:    map[string]any{},
		}
		if len(meta) > 0 {
			var payload map[string]any
			if json.Unmarshal(meta, &payload) == nil {
				step.Detail = payload
				if s, ok := payload["status"].(string); ok && s != "" {
					step.Status = s
				}
				if impl, ok := payload["implementation"].(string); ok {
					step.Implementation = impl
				}
			}
		}
		out = append(out, step)
	}
	return out
}
