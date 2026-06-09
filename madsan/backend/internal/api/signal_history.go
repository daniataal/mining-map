package api

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func loadSignalHistory(ctx context.Context, pool *pgxpool.Pool, entityType string, entityID uuid.UUID, limit int) []SignalHistoryEntry {
	if limit <= 0 || limit > 50 {
		limit = 15
	}
	rows, err := pool.Query(ctx, `
		SELECT signal_type, tier, confidence_score, payload, observed_at
		FROM core_signals
		WHERE entity_type = $1 AND entity_id = $2
		ORDER BY observed_at DESC
		LIMIT $3
	`, entityType, entityID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []SignalHistoryEntry
	for rows.Next() {
		var signalType, tier string
		var score float64
		var payload []byte
		var observedAt time.Time
		if rows.Scan(&signalType, &tier, &score, &payload, &observedAt) != nil {
			continue
		}
		entry := SignalHistoryEntry{
			SignalType:      signalType,
			Tier:            tier,
			ConfidenceScore: score,
			ObservedAt:      observedAt.UTC(),
			Label:           signalHistoryLabel(signalType, payload),
		}
		if opp, src := parseSignalPayload(payload); opp != nil {
			entry.OpportunityScore = opp
			entry.Source = src
		}
		out = append(out, entry)
	}
	return out
}

func parseSignalPayload(payload []byte) (*float64, string) {
	if len(payload) == 0 {
		return nil, ""
	}
	var m map[string]any
	if json.Unmarshal(payload, &m) != nil {
		return nil, ""
	}
	var opp *float64
	if v, ok := m["opportunity_score"].(float64); ok {
		opp = &v
	}
	src, _ := m["source"].(string)
	return opp, src
}

func signalHistoryLabel(signalType string, payload []byte) string {
	if len(payload) > 0 {
		var m map[string]any
		if json.Unmarshal(payload, &m) == nil {
			if signals, ok := m["signals"].([]any); ok && len(signals) > 0 {
				if first, ok := signals[0].(map[string]any); ok {
					if label, ok := first["label"].(string); ok && label != "" {
						return label
					}
				}
			}
		}
	}
	return strings.ReplaceAll(signalType, "_", " ")
}
