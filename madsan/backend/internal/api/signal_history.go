package api

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/intelligence"
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
		if signalType == "sts" {
			enrichSTSSignalHistory(&entry, payload, score)
		}
		out = append(out, entry)
	}
	return out
}

func loadVesselSTSSignalHistory(ctx context.Context, legacy *pgxpool.Pool, mmsi string, limit int) []SignalHistoryEntry {
	rows := intelligence.LoadVesselSTSHistory(ctx, legacy, mmsi, limit)
	out := make([]SignalHistoryEntry, 0, len(rows))
	for _, row := range rows {
		label := "STS proximity (AIS)"
		if row.CounterpartyName != "" {
			label = fmt.Sprintf("STS with %s", row.CounterpartyName)
		} else if row.CounterpartyMMSI != "" {
			label = fmt.Sprintf("STS with MMSI %s", row.CounterpartyMMSI)
		}
		detail := fmt.Sprintf("%s confidence · 6-factor weighted score", row.Score.Confidence)
		out = append(out, SignalHistoryEntry{
			SignalType:      "sts",
			Label:           label,
			Tier:            row.Score.DataTier,
			ConfidenceScore: row.Score.Score,
			ObservedAt:      row.ObservedAt,
			Source:          "ais_proximity",
			Detail:          detail,
			STSFactors:      toAPISTSScoreFactors(row.Score.Factors),
		})
	}
	return out
}

func mergeSignalHistory(primary, extra []SignalHistoryEntry, limit int) []SignalHistoryEntry {
	if len(extra) == 0 {
		return primary
	}
	merged := append(append([]SignalHistoryEntry{}, primary...), extra...)
	sort.Slice(merged, func(i, j int) bool {
		return merged[i].ObservedAt.After(merged[j].ObservedAt)
	})
	if limit <= 0 {
		limit = 15
	}
	if len(merged) > limit {
		merged = merged[:limit]
	}
	return merged
}

func enrichSTSSignalHistory(entry *SignalHistoryEntry, payload []byte, storedScore float64) {
	if entry.Tier == "" {
		entry.Tier = "observed"
	}
	in, ok := parseSTSScoreInput(payload)
	if !ok {
		if entry.Detail == "" {
			entry.Detail = "STS proximity signal (AIS observed)"
		}
		return
	}
	res := intelligence.ScoreSTS(in)
	entry.ConfidenceScore = res.Score
	entry.Tier = res.DataTier
	entry.Detail = fmt.Sprintf("%s confidence · 6-factor weighted score", res.Confidence)
	entry.STSFactors = toAPISTSScoreFactors(res.Factors)
	if storedScore > 0 && entry.ConfidenceScore == 0 {
		entry.ConfidenceScore = storedScore
	}
}

func parseSTSScoreInput(payload []byte) (intelligence.STSScoreInput, bool) {
	if len(payload) == 0 {
		return intelligence.STSScoreInput{}, false
	}
	var m map[string]any
	if json.Unmarshal(payload, &m) != nil {
		return intelligence.STSScoreInput{}, false
	}
	raw, err := json.Marshal(m)
	if err != nil {
		return intelligence.STSScoreInput{}, false
	}
	var in intelligence.STSScoreInput
	if json.Unmarshal(raw, &in) != nil {
		return intelligence.STSScoreInput{}, false
	}
	if in.DurationHours <= 0 && in.MinDistanceM <= 0 {
		return intelligence.STSScoreInput{}, false
	}
	if !in.OutsideTerminal {
		in.OutsideTerminal = true
	}
	return in, true
}

func toAPISTSScoreFactors(in []intelligence.STSScoreFactor) []STSScoreFactor {
	if len(in) == 0 {
		return nil
	}
	out := make([]STSScoreFactor, len(in))
	for i, f := range in {
		out[i] = STSScoreFactor{
			Name: f.Name, Weight: f.Weight, Score: f.Score, Weighted: f.Weighted, Detail: f.Detail,
		}
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
