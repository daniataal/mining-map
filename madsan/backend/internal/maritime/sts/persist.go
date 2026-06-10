package sts

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/intelligence"
)

func persistSTSSignal(ctx context.Context, pool *pgxpool.Pool, c Candidate, metaA, metaB VesselMeta, zoneID *uuid.UUID, zoneName string, inZone, bothTankers bool) error {
	durationH := c.EndTS.Sub(c.StartTS).Hours()
	score := intelligence.ScoreSTS(intelligence.STSScoreInput{
		MinDistanceM:    c.MinDistanceM,
		DurationHours:   durationH,
		AvgSOG:          c.AvgSOG,
		BothTankers:     bothTankers,
		InSTSZone:       inZone,
		OutsideTerminal: true,
		ZoneName:        zoneName,
	})

	pairKey := fmt.Sprintf("%s:%s:%d", c.MMSIA, c.MMSIB, c.StartTS.UTC().Unix())
	payload, _ := json.Marshal(map[string]any{
		"sts_pair_key":    pairKey,
		"mmsi_a":          c.MMSIA,
		"mmsi_b":          c.MMSIB,
		"vessel_a_name":   metaA.Name,
		"vessel_b_name":   metaB.Name,
		"vessel_a_class":  metaA.TankerClass,
		"vessel_b_class":  metaB.TankerClass,
		"start_ts":        c.StartTS.UTC().Format(time.RFC3339),
		"end_ts":          c.EndTS.UTC().Format(time.RFC3339),
		"centroid_lat":    c.CentroidLat,
		"centroid_lon":    c.CentroidLon,
		"min_distance_m":  c.MinDistanceM,
		"avg_sog":         c.AvgSOG,
		"sample_buckets":  c.SampleBuckets,
		"zone_id":         zoneIDStr(zoneID),
		"zone_name":       zoneName,
		"score":           score,
		"detector":        "ais_proximity_v1",
		"positions_table": "ais_positions",
		"disclaimer":      score.Disclaimer,
		"limitations":     score.Limitations,
	})

	entityID := metaA.ID
	if entityID == uuid.Nil {
		entityID = metaB.ID
	}
	if entityID == uuid.Nil {
		return nil
	}

	tag, err := pool.Exec(ctx, `
		UPDATE core_signals SET
			confidence_score = $2,
			tier = 'observed',
			payload = $3,
			observed_at = now()
		WHERE signal_type = 'sts' AND payload->>'sts_pair_key' = $4
	`, entityID, score.Score, payload, pairKey)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO core_signals (entity_type, entity_id, signal_type, tier, confidence_score, payload)
		VALUES ('vessel', $1, 'sts', 'observed', $2, $3)
	`, entityID, score.Score, payload)
	return err
}

func zoneIDStr(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return id.String()
}
